document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

const revealItems = document.querySelectorAll('.service-item, .work-card, .approach-copy, .contact-main');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
revealItems.forEach((item) => observer.observe(item));

const menuToggle = document.querySelector('.menu-toggle');
const siteMenu = document.querySelector('#site-menu');
if (menuToggle && siteMenu) {
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    siteMenu.classList.toggle('is-open', !isOpen);
  });
  siteMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menuToggle.setAttribute('aria-expanded', 'false');
      siteMenu.classList.remove('is-open');
    });
  });
}

const paymentModal = document.querySelector('#payment-modal');
const paymentForm = document.querySelector('#payment-form');
const selectedPlan = document.querySelector('#selected-plan');
const selectedAmount = document.querySelector('#selected-amount');
const contactForm = document.querySelector('#contact-form');
let activePlan = { name: 'Growth', amount: 200000 };
const apiBaseUrl = (window.CMC_API_BASE_URL || '').replace(/\/$/, '');

const apiUrl = (path) => `${apiBaseUrl}${path}`;

const closePaymentModal = () => {
  if (!paymentModal) return;
  paymentModal.classList.remove('is-open');
  paymentModal.setAttribute('aria-hidden', 'true');
};

fetch(apiUrl('/api/track-visit'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: window.location.pathname || '/' })
}).catch(() => {});

if (paymentModal && selectedPlan && selectedAmount) {
  document.querySelectorAll('[data-plan][data-amount]').forEach((button) => {
    button.addEventListener('click', () => {
      activePlan = { name: button.dataset.plan, amount: Number(button.dataset.amount) };
      selectedPlan.textContent = activePlan.name;
      selectedAmount.textContent = `₦${activePlan.amount.toLocaleString('en-NG')}`;
      paymentModal.classList.add('is-open');
      paymentModal.setAttribute('aria-hidden', 'false');
      document.querySelector('#customer-name').focus();
    });
  });

  const modalCloseButton = document.querySelector('.modal-close');
  if (modalCloseButton) modalCloseButton.addEventListener('click', closePaymentModal);
  paymentModal.addEventListener('click', (event) => {
    if (event.target === paymentModal) closePaymentModal();
  });
}

if (contactForm) {
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(contactForm);
    const payload = {
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      business: formData.get('business'),
      service: formData.get('service'),
      message: formData.get('message')
    };

    try {
      const response = await fetch(apiUrl('/api/enquiry'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Unable to send enquiry');
      }

      contactForm.reset();
      alert('Thanks! Your enquiry has been received. We will be in touch soon.');
    } catch (error) {
      alert('Your enquiry could not be submitted right now. Please email us directly.');
    }
  });
}

if (paymentForm && paymentModal) {
  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(paymentForm);
    const reference = `CMC-${Date.now()}`;

    try {
      const response = await fetch(apiUrl('/api/payment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: formData.get('name'),
          email: formData.get('email'),
          plan: activePlan.name,
          amount: activePlan.amount,
          reference,
          status: 'pending'
        })
      });

      if (!response.ok) throw new Error('Unable to submit payment request');
      closePaymentModal();
      paymentForm.reset();
      alert(`Payment request received. Reference: ${reference}`);
    } catch (error) {
      alert('Your payment request could not be submitted right now. Please contact us directly.');
    }
  });
}
