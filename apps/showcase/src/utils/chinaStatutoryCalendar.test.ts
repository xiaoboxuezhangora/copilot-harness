import { describe, expect, it } from "vitest";
import { getChinaDayType } from "./chinaStatutoryCalendar";

describe("getChinaDayType", () => {
  it("识别 2026 法定节假日", () => {
    const dayType = getChinaDayType(new Date(2026, 1, 18)); // 2026-02-18
    expect(dayType.isStatutoryHoliday).toBe(true);
    expect(dayType.isRestDay).toBe(true);
    expect(dayType.label).toContain("法定节假日");
  });

  it("识别调休上班日", () => {
    const dayType = getChinaDayType(new Date(2026, 1, 28)); // 2026-02-28
    expect(dayType.isStatutoryHoliday).toBe(false);
    expect(dayType.isRestDay).toBe(false);
    expect(dayType.label).toBe("调休上班日");
  });

  it("周末无调休时为休息日", () => {
    const dayType = getChinaDayType(new Date(2026, 2, 1)); // 2026-03-01
    expect(dayType.isStatutoryHoliday).toBe(false);
    expect(dayType.isRestDay).toBe(true);
    expect(dayType.label).toBe("周末休息日");
  });
});

