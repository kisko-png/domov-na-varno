import { listProtocols } from "../core/protocols.js";
import { RISK_TIERS } from "../core/riskTiers.js";
import { SL } from "../strings.sl.js";
import type { ProtocolView } from "./patient.js";

/** The base protocols as the API shows them. */
export class ProtocolService {
  /** The catalogue in its order, each with its risk tier's silence thresholds and the demo notice. */
  list(): ProtocolView[] {
    return listProtocols().map((protocol) => ({
      ...protocol,
      silence: { ...RISK_TIERS[protocol.riskTier].silence },
      demoNotice: SL.patient.demoNotice,
    }));
  }
}
