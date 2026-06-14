// ARM64 CPU State — 31 GP registers, SP, PC, PSTATE (NZCV flags)

export class CpuState {
  // General purpose registers X0-X30 (64-bit)
  readonly x: BigInt64Array;
  // Stack pointer
  sp: bigint = 0n;
  // Program counter
  pc: bigint = 0n;
  // Condition flags
  n: boolean = false; // Negative
  z: boolean = false; // Zero
  c: boolean = false; // Carry
  overflow: boolean = false; // Overflow

  // SIMD/FP registers V0-V31 (128-bit, stored as pairs of 64-bit)
  readonly vector: Float64Array;
  // FPCR and FPSR
  fpcr: number = 0;
  fpsr: number = 0;

  // Exclusive monitor for LDXR/STXR
  exclusiveAddress: bigint = -1n;
  exclusiveSize: number = 0;

  // Thread-local storage base (TPIDR_EL0)
  tpidrEl0: bigint = 0n;

  // Cycle counter for timing
  cycleCount: bigint = 0n;

  constructor() {
    this.x = new BigInt64Array(31);
    this.vector = new Float64Array(64); // 32 registers × 2 (high/low)
  }

  getX(reg: number): bigint {
    if (reg === 31) return this.sp;
    return BigInt.asUintN(64, this.x[reg]);
  }

  setX(reg: number, value: bigint): void {
    if (reg === 31) {
      this.sp = BigInt.asUintN(64, value);
      return;
    }
    this.x[reg] = BigInt.asIntN(64, value);
  }

  getW(reg: number): number {
    if (reg === 31) return Number(this.sp & 0xFFFFFFFFn);
    return Number(BigInt.asUintN(32, this.x[reg]));
  }

  setW(reg: number, value: number): void {
    const val = BigInt(value >>> 0);
    if (reg === 31) {
      this.sp = val;
      return;
    }
    this.x[reg] = BigInt.asIntN(64, val);
  }

  // Link register
  get lr(): bigint { return this.getX(30); }
  set lr(value: bigint) { this.setX(30, value); }

  // Get NZCV packed into a 32-bit value
  get nzcv(): number {
    return (this.n ? 0x80000000 : 0) |
           (this.z ? 0x40000000 : 0) |
           (this.c ? 0x20000000 : 0) |
           (this.overflow ? 0x10000000 : 0);
  }

  set nzcv(value: number) {
    this.n = (value & 0x80000000) !== 0;
    this.z = (value & 0x40000000) !== 0;
    this.c = (value & 0x20000000) !== 0;
    this.overflow = (value & 0x10000000) !== 0;
  }

  updateFlagsNZ64(result: bigint): void {
    this.n = BigInt.asIntN(64, result) < 0n;
    this.z = BigInt.asUintN(64, result) === 0n;
  }

  updateFlagsNZ32(result: number): void {
    this.n = (result | 0) < 0;
    this.z = (result >>> 0) === 0;
  }

  checkCondition(cond: number): boolean {
    let result: boolean;
    switch (cond >> 1) {
      case 0: result = this.z; break;                    // EQ/NE
      case 1: result = this.c; break;                    // CS/CC
      case 2: result = this.n; break;                    // MI/PL
      case 3: result = this.overflow; break;             // VS/VC
      case 4: result = this.c && !this.z; break;         // HI/LS
      case 5: result = this.n === this.overflow; break;  // GE/LT
      case 6: result = this.n === this.overflow && !this.z; break; // GT/LE
      case 7: result = true; break;                      // AL
      default: result = true;
    }
    return (cond & 1) && cond !== 0xF ? !result : result;
  }
}
