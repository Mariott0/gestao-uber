if (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) {
  document.documentElement.classList.add('app-instalado');
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.content += ', maximum-scale=1, user-scalable=no';
  // O Safari também sinaliza o gesto de pinça por eventos próprios.
  for (const gesto of ['gesturestart', 'gesturechange']) {
    document.addEventListener(gesto, evento => evento.preventDefault(), { passive: false });
  }
}
