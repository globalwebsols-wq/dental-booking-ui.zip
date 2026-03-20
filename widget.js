(function () {
  const style = document.createElement('style');
  style.innerHTML = `
    #dbw-btn{position:fixed;right:20px;bottom:20px;background:#2563eb;color:#fff;border-radius:999px;padding:14px 18px;font:600 14px Arial,sans-serif;cursor:pointer;z-index:999999;box-shadow:0 10px 30px rgba(37,99,235,.35)}
    #dbw-box{position:fixed;right:20px;bottom:80px;width:360px;height:540px;background:#fff;border-radius:22px;box-shadow:0 18px 60px rgba(15,23,42,.18);display:none;overflow:hidden;z-index:999999;font-family:Arial,sans-serif}
    #dbw-head{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;padding:18px 18px 16px}
    #dbw-title{font-size:16px;font-weight:700;margin:0}
    #dbw-sub{font-size:12px;opacity:.9;margin-top:4px}
    #dbw-msgs{height:360px;overflow-y:auto;background:#f8fafc;padding:14px}
    .dbw-row{display:flex;margin:8px 0}
    .dbw-ai,.dbw-user{padding:10px 12px;border-radius:14px;max-width:85%;line-height:1.45;font-size:14px;white-space:pre-wrap;word-break:break-word}
    .dbw-ai{background:#fff;border:1px solid #e2e8f0;color:#0f172a}
    .dbw-user{background:#2563eb;color:#fff;margin-left:auto}
    #dbw-slots{padding:0 14px 8px;background:#f8fafc}
    .dbw-slot{display:block;width:100%;margin:8px 0;padding:10px 12px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;cursor:pointer;text-align:left;font-size:13px}
    .dbw-slot:hover{border-color:#2563eb;background:#eff6ff}
    #dbw-form{display:flex;border-top:1px solid #e2e8f0;background:#fff}
    #dbw-input{flex:1;border:none;outline:none;padding:15px;font-size:14px}
    #dbw-send{border:none;background:#2563eb;color:#fff;padding:0 16px;cursor:pointer}
    #dbw-note{font-size:11px;color:#64748b;padding:10px 14px;background:#fff;border-top:1px solid #e2e8f0}
  `;
  document.head.appendChild(style);

  const btn = document.createElement('div');
  btn.id = 'dbw-btn';
  btn.textContent = 'Book Appointment';

  const box = document.createElement('div');
  box.id = 'dbw-box';
  box.innerHTML = `
    <div id="dbw-head">
      <div id="dbw-title">Dental Assistant</div>
      <div id="dbw-sub">Fast booking with live availability</div>
    </div>
    <div id="dbw-msgs"></div>
    <div id="dbw-slots"></div>
    <form id="dbw-form">
      <input id="dbw-input" placeholder="Type here..." autocomplete="off" />
      <button id="dbw-send" type="submit">Send</button>
    </form>
    <div id="dbw-note">It will ask for your name, email, phone, then show available times.</div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(box);

  const msgs = box.querySelector('#dbw-msgs');
  const slotsWrap = box.querySelector('#dbw-slots');
  const form = box.querySelector('#dbw-form');
  const input = box.querySelector('#dbw-input');

  function addMessage(text, cls) {
    const row = document.createElement('div');
    row.className = 'dbw-row';
    const bubble = document.createElement('div');
    bubble.className = cls;
    bubble.textContent = text;
    row.appendChild(bubble);
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function clearSlots() {
    slotsWrap.innerHTML = '';
  }

  function renderSlots(slots) {
    clearSlots();
    if (!Array.isArray(slots) || !slots.length) return;
    slots.forEach((slot) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dbw-slot';
      b.textContent = slot.label;
      b.addEventListener('click', async () => {
        addMessage(slot.label, 'dbw-user');
        clearSlots();
        await sendPayload({ message: slot.label, selectedSlot: slot.id });
      });
      slotsWrap.appendChild(b);
    });
  }

  async function sendPayload(payload) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    addMessage(data.reply || 'Sorry, something went wrong.', 'dbw-ai');
    if (data.slots) renderSlots(data.slots); else clearSlots();
    if (data.bookingLink) {
      const a = document.createElement('a');
      a.href = data.bookingLink;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Open calendar booking';
      a.style.display = 'inline-block';
      a.style.margin = '6px 0 0 14px';
      a.style.color = '#2563eb';
      a.style.font = '600 13px Arial,sans-serif';
      msgs.appendChild(a);
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  let started = false;
  btn.addEventListener('click', async () => {
    box.style.display = box.style.display === 'block' ? 'none' : 'block';
    if (!started) {
      started = true;
      await sendPayload({ message: 'start' });
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, 'dbw-user');
    input.value = '';
    await sendPayload({ message: text });
  });
})();
