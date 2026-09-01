(function () {
  const header = document.querySelector('[data-lr-header]');
  const toggle = document.querySelector('[data-lr-menu-toggle]');
  const menu = document.querySelector('[data-lr-menu]');

  const updateHeader = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 24);
  };

  const closeMenu = () => {
    if (!header || !toggle || !menu) return;
    header.classList.remove('is-menu-open');
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
  };

  if (header) {
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  }

  if (toggle && menu && header) {
    toggle.addEventListener('click', () => {
      const open = !menu.classList.contains('is-open');
      menu.classList.toggle('is-open', open);
      header.classList.toggle('is-menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        toggle.focus();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1220) closeMenu();
    });
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sharedHeroImages = [
    '/media/front.png',
    '/media/site.png',
    '/media/clubhouse.png',
    '/media/dog.park.png',
    '/media/showers.jpg',
  ];

  document.querySelectorAll('[data-lr-background-slider]').forEach((hero) => {
    const originalImage = Array.from(hero.children).find((node) => node.tagName === 'IMG');
    if (!originalImage) return;

    const sources = [originalImage.getAttribute('src'), ...sharedHeroImages]
      .filter((source, index, items) => source && items.indexOf(source) === index);
    if (sources.length < 2) return;

    originalImage.classList.add('lr-hero-slide', 'is-active');
    const slides = [originalImage];
    const insertionPoint = Array.from(hero.children).find((node) => node !== originalImage);

    sources.slice(1).forEach((source) => {
      const image = document.createElement('img');
      image.className = 'lr-hero-slide';
      image.src = source;
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.setAttribute('decoding', 'async');
      hero.insertBefore(image, insertionPoint || null);
      slides.push(image);
    });

    let activeIndex = 0;
    let timer;
    const showSlide = (nextIndex) => {
      activeIndex = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, index) => slide.classList.toggle('is-active', index === activeIndex));
    };
    const stopSlider = () => window.clearInterval(timer);
    const startSlider = () => {
      stopSlider();
      if (!reducedMotion && !document.hidden) {
        timer = window.setInterval(() => showSlide(activeIndex + 1), 5500);
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopSlider();
      else startSlider();
    });
    startSlider();
  });

  const reveals = document.querySelectorAll('.lr-reveal');
  if (!('IntersectionObserver' in window) || reducedMotion) {
    reveals.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -48px 0px' });

  reveals.forEach((node) => observer.observe(node));
})();
