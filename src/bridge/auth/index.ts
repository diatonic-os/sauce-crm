// MOB-BRIDGE-001 · T-C — bridge auth public surface.
export {
  HmacAuthSigner,
  HmacAuthVerifier,
  constantTimeEqualHex,
  type HmacCrypto,
  type KeyProvider,
  type HmacVerifierOpts,
} from "./HmacAuth";

export {
  generatePairingToken,
  tokenToKey,
  type PairingStore,
  type PairingHasher,
  type RandomBytes,
} from "./Pairing";
