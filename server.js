require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TIMEZONE = process.env.TIMEZONE || 'Europe/Bucharest';
const GOOGLE_SERVICE_ACCOUNT_KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'credentials.json';
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const APPOINTMENT_DURATION_MINUTES = Number(process.env.APPOINTMENT_DURATION_MINUTES || 30);
const MAX_SLOT_DAYS_AHEAD = Number(process.env.MAX_SLOT_DAYS_AHEAD || 7);
const BOOKING_TITLE_PREFIX = process.env.BOOKING_TITLE_PREFIX || 'Dental Consultation';
const CLINIC_NAME = process.env.CLINIC_NAME || 'Your Clinic';
const CLINIC_LOCATION = process.env.CLINIC_LOCATION || 'Online / Clinic';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || '';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = {};

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

const keyFilePath = path.join(__dirname, GOOGLE_SERVICE_ACCOUNT_KEY_FILE);
const hasCalendarCredentials = fileExists(keyFilePath);

let calendar = null;
if (hasCalendarCredentials) {
  const auth = new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  calendar = google.calendar({ version: 'v3', auth });
}

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function getUserKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return /^[0-9+()\-\s]{6,20}$/.test(phone);
}

function ensureDataDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveLead(lead) {
  const dir = ensureDataDir();
  const jsonPath = path.join(dir, 'leads.json');
  let items = [];
  if (fs.existsSync(jsonPath)) {
    try {
      items = JSON.parse(fs.readFileSync(jsonPath, 'utf8') || '[]');
      if (!Array.isArray(items)) items = [];
    } catch {
      items = [];
    }
  }
  items.push(lead);
  fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2), 'utf8');

  const csvPath = path.join(dir, 'leads.csv');
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, 'date,name,email,phone,selected_slot,calendar_event_id,calendar_link,source\n', 'utf8');
  }
  const escapeCsv = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
  const row = [
    lead.date,
    lead.name,
    lead.email,
    lead.phone,
    lead.selectedSlot,
    lead.calendarEventId,
    lead.calendarLink,
    lead.source,
  ].map(escapeCsv).join(',');
  fs.appendFileSync(csvPath, row + '\n', 'utf8');
}

async function sendLeadEmail(lead) {
  if (!transporter || !ADMIN_EMAIL) return;
  const html = `
    <h2>New Booking</h2>
    <p><strong>Name:</strong> ${lead.name}</p>
    <p><strong>Email:</strong> ${lead.email}</p>
    <p><strong>Phone:</strong> ${lead.phone}</p>
    <p><strong>Selected Slot:</strong> ${lead.selectedSlot}</p>
    <p><strong>Calendar Link:</strong> ${lead.calendarLink || '-'}</p>
    <p><strong>Created At:</strong> ${lead.date}</p>
  `;
  await transporter.sendMail({
    from: SMTP_FROM,
    to: ADMIN_EMAIL,
    subject: 'New Dental Booking',
    html,
  });
}

function startOfNextHour(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function formatHuman(date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIMEZONE,
  }).format(date);
}

function formatIso(date) {
  return new Date(date).toISOString();
}

function isBusinessSlot(date) {
  const d = new Date(date);
  const day = d.getDay();
  const hour = d.getHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
}

async function listEvents(timeMin, timeMax) {
  if (!calendar) throw new Error('Calendar credentials missing');
  const { data } = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });
  return data.items || [];
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function getAvailableSlots(limit = 6) {
  if (!calendar) throw new Error('Calendar credentials missing');
  const now = new Date();
  const min = startOfNextHour(now);
  const max = new Date(now.getTime() + MAX_SLOT_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const existing = await listEvents(min, max);

  const slots = [];
  let cursor = new Date(min);

  while (cursor < max && slots.length < limit) {
    const end = new Date(cursor.getTime() + APPOINTMENT_DURATION_MINUTES * 60000);
    if (isBusinessSlot(cursor)) {
      const busy = existing.some((ev) => {
        if (!ev.start?.dateTime || !ev.end?.dateTime) return false;
        const evStart = new Date(ev.start.dateTime);
        const evEnd = new Date(ev.end.dateTime);
        return overlaps(cursor, end, evStart, evEnd);
      });

      if (!busy) {
        slots.push({
          id: formatIso(cursor),
          label: formatHuman(cursor),
          start: formatIso(cursor),
          end: formatIso(end),
        });
      }
    }
    cursor = new Date(cursor.getTime() + 60 * 60000);
  }

  return slots;
}

async function createCalendarBooking({ name, email, phone, slotStartIso }) {
  if (!calendar) throw new Error('Calendar credentials missing');
  const start = new Date(slotStartIso);
  const end = new Date(start.getTime() + APPOINTMENT_DURATION_MINUTES * 60000);

  const checkEvents = await listEvents(start, end);
  const alreadyTaken = checkEvents.some((ev) => {
    if (!ev.start?.dateTime || !ev.end?.dateTime) return false;
    return overlaps(start, end, new Date(ev.start.dateTime), new Date(ev.end.dateTime));
  });
  if (alreadyTaken) throw new Error('Selected slot is no longer available');

  const resource = {
    summary: `${BOOKING_TITLE_PREFIX} - ${name}`,
    description: `Booked by chatbot\nName: ${name}\nEmail: ${email}\nPhone: ${phone}`,
    start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
    location: CLINIC_LOCATION,
  };

  const { data } = await calendar.events.insert({
    calendarId: GOOGLE_CALENDAR_ID,
    resource,
  });

  return {
    eventId: data.id || '',
    htmlLink: data.htmlLink || '',
    startLabel: formatHuman(start),
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, calendarReady: hasCalendarCredentials });
});

app.get('/api/slots', async (req, res) => {
  try {
    const slots = await getAvailableSlots(6);
    res.json({ ok: true, slots });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Failed to load slots' });
  }
});

app.post('/api/chat/reset', (req, res) => {
  const key = getUserKey(req);
  delete sessions[key];
  res.json({ reply: 'Conversation reset. Hi 👋 What\'s your name?' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, selectedSlot } = req.body;
    const text = String(message || '').trim();
    const key = getUserKey(req);

    if (!sessions[key]) {
      sessions[key] = { step: 'ask_name', createdAt: Date.now() };
      return res.json({ reply: `Hi 👋 Welcome to ${CLINIC_NAME}. What's your name?` });
    }

    const session = sessions[key];

    if (session.step === 'ask_name') {
      if (!text) return res.json({ reply: 'Please tell me your name 😊' });
      session.name = text;
      session.step = 'ask_email';
      return res.json({ reply: `Nice to meet you ${session.name}! What's your email?` });
    }

    if (session.step === 'ask_email') {
      if (!isValidEmail(text)) return res.json({ reply: 'Please enter a valid email address 😊' });
      session.email = text;
      session.step = 'ask_phone';
      return res.json({ reply: 'Great! What\'s your phone number?' });
    }

    if (session.step === 'ask_phone') {
      if (!isValidPhone(text)) return res.json({ reply: 'Please enter a valid phone number 😊' });
      session.phone = text;
      session.step = 'ask_slot';
      const slots = await getAvailableSlots(6);
      if (!slots.length) {
        delete sessions[key];
        return res.json({ reply: 'Sorry, there are no free slots right now. Please try again later.' });
      }
      session.slots = slots;
      return res.json({
        reply: 'Perfect. Please choose an available time below.',
        slots,
      });
    }

    if (session.step === 'ask_slot') {
      const slotId = String(selectedSlot || text || '').trim();
      const matched = (session.slots || []).find((s) => s.id === slotId || s.label === slotId);
      if (!matched) {
        return res.json({
          reply: 'Please select one of the available slots from the buttons below.',
          slots: session.slots || [],
        });
      }

      const booking = await createCalendarBooking({
        name: session.name,
        email: session.email,
        phone: session.phone,
        slotStartIso: matched.start,
      });

      const lead = {
        name: session.name,
        email: session.email,
        phone: session.phone,
        date: new Date().toISOString(),
        selectedSlot: booking.startLabel,
        calendarEventId: booking.eventId,
        calendarLink: booking.htmlLink,
        source: 'website-chatbot',
      };

      saveLead(lead);
      try {
        await sendLeadEmail(lead);
      } catch (emailErr) {
        console.error('Email send error:', emailErr.message);
      }

      delete sessions[key];
      return res.json({
        reply: `Thanks ${lead.name}! 🎉 Your appointment is booked for ${lead.selectedSlot}.`,
        bookingLink: lead.calendarLink,
      });
    }

    delete sessions[key];
    return res.json({ reply: `Hi 👋 Welcome to ${CLINIC_NAME}. What's your name?` });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ reply: err.message || 'Something went wrong. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
