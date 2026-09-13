import { isIP } from "node:net";

export function createPinnedLookup(pinnedAddress = {}) {
  const address = String(pinnedAddress.address || "").trim();
  const family = Number(pinnedAddress.family);
  if (!isIP(address) || !new Set([4, 6]).has(family)) {
    throw new Error("Pinned lookup requires a valid IP address and family");
  }

  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}
