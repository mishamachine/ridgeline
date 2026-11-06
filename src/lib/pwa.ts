export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
export const A2HS_TIP = 'On iPhone, tap Share, then Add to Home Screen, so Safari keeps your saved maps.';
