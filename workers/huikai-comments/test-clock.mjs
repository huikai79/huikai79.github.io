const RealDate = globalThis.Date;
const FIXED_NOW = RealDate.parse("2026-09-11T00:00:00.000Z");

class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [FIXED_NOW]));
  }

  static now() {
    return FIXED_NOW;
  }
}

globalThis.Date = FixedDate;
