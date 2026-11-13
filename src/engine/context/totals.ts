/**
 * Functions that are a short way of writing CALCULATE with a time-intelligence filter:
 *   TOTALYTD(expression, dates, [filter], [year end])  = CALCULATE(expression, DATESYTD(dates[, year end]), filter)
 * Checked in Power BI Desktop on Initech (every month of 2024–2026 gave the same value both ways):
 *   CLOSINGBALANCEMONTH(expression, dates) = CALCULATE(expression, ENDOFMONTH(dates))
 *   OPENINGBALANCEMONTH(expression, dates) = CALCULATE(expression, PREVIOUSDAY(STARTOFMONTH(dates)))
 */
export interface TotalShape {
  /** The name the date rule is described by (a time-intelligence function, or the function itself). */
  rule: string;
  /** The filter DAX, from the dates argument (and the year end, if written). */
  dax: (dates: string, yearEnd?: string) => string;
}

const call = (name: string) => (dates: string, yearEnd?: string) => `${name}(${dates}${yearEnd ? `, ${yearEnd}` : ''})`;
const opening = (period: string) => (dates: string, yearEnd?: string) => `PREVIOUSDAY(STARTOF${period}(${dates}${yearEnd ? `, ${yearEnd}` : ''}))`;

export const TOTALS: ReadonlyMap<string, TotalShape> = new Map<string, TotalShape>([
  ['TOTALYTD', { rule: 'DATESYTD', dax: call('DATESYTD') }],
  ['TOTALQTD', { rule: 'DATESQTD', dax: call('DATESQTD') }],
  ['TOTALMTD', { rule: 'DATESMTD', dax: call('DATESMTD') }],
  ['TOTALWTD', { rule: 'DATESWTD', dax: call('DATESWTD') }],
  ...(['WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const).flatMap((period): [string, TotalShape][] => [
    [`CLOSINGBALANCE${period}`, { rule: `ENDOF${period}`, dax: call(`ENDOF${period}`) }],
    [`OPENINGBALANCE${period}`, { rule: `OPENINGBALANCE${period}`, dax: opening(period) }],
  ]),
]);
