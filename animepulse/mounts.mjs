// mounts.mjs: real mount check for the external drive (an existing folder is NOT proof the drive is mounted).
import fs from 'fs';

export const EXTERNAL_ROOT = process.env.ANIMEPULSE_DRIVE || '/media/dev/PHONE_3D';

// True only when `mp` appears as a mountpoint in /proc/mounts.
export function isMounted(mp = EXTERNAL_ROOT) {
  try {
    const want = fs.realpathSync(mp);
    return fs.readFileSync('/proc/mounts', 'utf8').split('\n').some((line) => {
      const dir = (line.split(' ')[1] || '').replace(/\\040/g, ' ');
      return dir === want || dir === mp;
    });
  } catch (_) { return false; }
}
