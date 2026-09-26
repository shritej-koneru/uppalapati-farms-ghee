import { contactEnquiryMessage, whatsappLink } from './business.js';

const form = document.querySelector('[data-contact-form]');
const status = document.querySelector('[data-contact-status]');
const submit = document.querySelector('[data-contact-submit]');

if (form) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      status.textContent = 'Please complete the required fields with valid details.';
      form.querySelector(':invalid')?.focus();
      return;
    }

    const data = new FormData(form);
    const details = {
      name: String(data.get('name') || '').trim(),
      mobile: String(data.get('mobile') || '').trim(),
      email: String(data.get('email') || '').trim(),
      subject: String(data.get('subject') || 'General enquiry'),
      message: String(data.get('message') || '').trim(),
    };

    submit.disabled = true;
    status.textContent = 'Opening WhatsApp…';

    const url = whatsappLink(contactEnquiryMessage(details));
    window.open(url, '_blank', 'noopener');

    window.setTimeout(() => {
      form.reset();
      submit.disabled = false;
      status.textContent = 'WhatsApp should now be open in a new tab with your message ready to send.';
    }, 600);
  });
}
