window.HYPN_CONFIG = {
  authWorkerUrl: "https://hypn-remote-image-auth.hypnoticfbtclub.workers.dev"
};

window.addEventListener('DOMContentLoaded', () => {
  const script = document.createElement('script');
  script.src = 'gallery-v14.js?v=140';
  script.defer = true;
  document.body.appendChild(script);
});
