interface HolidayRange {
  start: string;
  end: string;
  name: string;
}

interface YearHolidayPlan {
  holidays: HolidayRange[];
  adjustedWorkdays: string[];
}

interface DayTypeResult {
  isRestDay: boolean;
  isStatutoryHoliday: boolean;
  label: string;
}

const yearHolidayPlans: Record<number, YearHolidayPlan> = {
  // Source: 国务院办公厅关于 2026 年部分节假日安排的通知（2025-11）
  2026: {
    holidays: [
      { name: "元旦", start: "2026-01-01", end: "2026-01-03" },
      { name: "春节", start: "2026-02-15", end: "2026-02-23" },
      { name: "清明节", start: "2026-04-04", end: "2026-04-06" },
      { name: "劳动节", start: "2026-05-01", end: "2026-05-05" },
      { name: "端午节", start: "2026-06-19", end: "2026-06-21" },
      { name: "中秋节", start: "2026-09-25", end: "2026-09-27" },
      { name: "国庆节", start: "2026-10-01", end: "2026-10-07" },
    ],
    adjustedWorkdays: [
      "2026-01-04",
      "2026-02-14",
      "2026-02-28",
      "2026-05-09",
      "2026-09-20",
      "2026-10-10",
    ],
  },
};

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function buildDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = parseDateKey(start);
  const last = parseDateKey(end);

  while (cursor.getTime() <= last.getTime()) {
    dates.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

const yearHolidayTables = Object.entries(yearHolidayPlans).reduce(
  (tables, [yearText, plan]) => {
    const holidayLabelByDate = new Map<string, string>();
    const adjustedWorkdaySet = new Set(plan.adjustedWorkdays);

    plan.holidays.forEach((holiday) => {
      buildDateRange(holiday.start, holiday.end).forEach((date) => {
        holidayLabelByDate.set(date, holiday.name);
      });
    });

    tables.set(Number(yearText), { holidayLabelByDate, adjustedWorkdaySet });
    return tables;
  },
  new Map<
    number,
    {
      holidayLabelByDate: Map<string, string>;
      adjustedWorkdaySet: Set<string>;
    }
  >(),
);

export function getChinaDayType(date: Date): DayTypeResult {
  const key = formatDateKey(date);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const table = yearHolidayTables.get(date.getFullYear());

  if (!table) {
    return {
      isRestDay: isWeekend,
      isStatutoryHoliday: false,
      label: isWeekend ? "周末休息日" : "工作日",
    };
  }

  const holidayName = table.holidayLabelByDate.get(key);
  const isStatutoryHoliday = holidayName !== undefined;
  const isAdjustedWorkday = table.adjustedWorkdaySet.has(key);
  const isRestDay = isStatutoryHoliday || (isWeekend && !isAdjustedWorkday);

  if (isStatutoryHoliday) {
    return {
      isRestDay: true,
      isStatutoryHoliday: true,
      label: `${holidayName}（法定节假日）`,
    };
  }

  if (isAdjustedWorkday) {
    return {
      isRestDay: false,
      isStatutoryHoliday: false,
      label: "调休上班日",
    };
  }

  return {
    isRestDay,
    isStatutoryHoliday: false,
    label: isRestDay ? "周末休息日" : "工作日",
  };
}

