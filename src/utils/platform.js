/**
 * platform — which shell is the app running inside?
 *
 * The web app is served identically to a browser and to the native iOS shell
 * (the shell points at the live site), so a handful of behaviours have to
 * branch on this. Keep those branches few and obvious.
 */

/** True when running inside the Capacitor native shell rather than a browser. */
export function isNativeApp() {
  try {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

/** A registered Capacitor plugin, or null when not running natively. */
export function nativePlugin(name) {
  try {
    return (isNativeApp() && window.Capacitor.Plugins?.[name]) || null;
  } catch {
    return null;
  }
}
