# Dental Booking Widget with Time Selection

This project asks for:
- name
- email
- phone
- then shows available Google Calendar slots
- books the selected slot instantly

## Setup

1. Upload your Google service account JSON file into the project root.
2. Rename it to `credentials.json` or update `.env`.
3. Share your Google Calendar with the `client_email` from that JSON file.
4. Give it permission: **Make changes to events**.
5. Copy `.env.example` to `.env` and fill values.
6. Run:

```bash
npm install
npm start
```

## Railway

- Upload code to GitHub
- Deploy on Railway
- Add environment variables from `.env.example`
- Upload the JSON file in the project root if your deployment method supports it, or commit it privately only for testing

## Embed

```html
<script src="https://your-domain.com/widget.js"></script>
```

## Notes

- Slot search is Monday-Friday, 9:00 to 17:00.
- Duration is controlled by `APPOINTMENT_DURATION_MINUTES`.
- Leads are stored in `data/leads.json` and `data/leads.csv`.
