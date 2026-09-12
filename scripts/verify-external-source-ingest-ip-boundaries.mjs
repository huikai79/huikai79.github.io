#!/usr/bin/env node
import assert from "node:assert/strict";
import { isPublicIpAddress } from "./external-source-ingest-contract.mjs";

for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1"]) {
  assert.equal(isPublicIpAddress(address), false, `${address} must be rejected`);
}
for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
  assert.equal(isPublicIpAddress(address), true, `${address} must be accepted`);
}
console.log("external source IP boundaries: ok");
