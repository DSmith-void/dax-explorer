/**
 * Plain functions: they work out a value from their inputs and change no filters and no rows, so the
 * generic rules apply (their inputs are calculated in the same context, and their value comes from Power BI).
 *
 * Sources: the input lists follow Microsoft's DAX reference and dax.guide, and every minimum and maximum
 * number of inputs, and every "must be a column / table" input, was confirmed by Power BI Desktop itself
 * (see powerBiArity.ts, checked by a test).
 */
import { params, type FunctionCategory, type FunctionSpec } from './spec';

const fn = (name: string, category: FunctionCategory, signature: string, summary: string, returns: 'scalar' | 'table' = 'scalar'): FunctionSpec => ({
  name,
  category,
  returns,
  summary,
  overloads: [params(signature)],
});

/** Goes through a table row by row (the first input), working out the `row` inputs for each row. */
const iter = (name: string, signature: string, summary: string, category: FunctionCategory = 'iterator'): FunctionSpec => ({
  ...fn(name, category, signature, summary),
  iteratesArgument: 0,
});

const same = (names: string[], make: (name: string) => FunctionSpec) => names.map(make);

const DATE_AND_TIME: FunctionSpec[] = [
  fn('DATE', 'date and time', 'year, month, day', 'Makes a date from a year, month and day.'),
  fn('TIME', 'date and time', 'hour, minute, second', 'Makes a time from hours, minutes and seconds.'),
  fn('DATEVALUE', 'date and time', 'date text', 'Turns a date written as text into a date.'),
  fn('TIMEVALUE', 'date and time', 'time text', 'Turns a time written as text into a time.'),
  fn('YEAR', 'date and time', 'date', 'The year of a date.'),
  fn('QUARTER', 'date and time', 'date', 'The quarter of a date, 1 to 4.'),
  fn('MONTH', 'date and time', 'date', 'The month of a date, 1 to 12.'),
  fn('DAY', 'date and time', 'date', 'The day of the month of a date, 1 to 31.'),
  fn('HOUR', 'date and time', 'date', 'The hour of a date and time, 0 to 23.'),
  fn('MINUTE', 'date and time', 'date', 'The minute of a date and time, 0 to 59.'),
  fn('SECOND', 'date and time', 'date', 'The second of a date and time, 0 to 59.'),
  fn('TODAY', 'date and time', '', "Today's date (on the computer or service that calculates it)."),
  fn('NOW', 'date and time', '', 'The current date and time.'),
  fn('UTCTODAY', 'date and time', '', "Today's date in UTC."),
  fn('UTCNOW', 'date and time', '', 'The current date and time in UTC.'),
  fn('EDATE', 'date and time', 'start date, months', 'The date a number of months before or after a date.'),
  fn('EOMONTH', 'date and time', 'start date, months', 'The last day of the month, a number of months before or after a date.'),
  fn('DATEDIFF', 'date and time', 'start date, end date, kw:SECOND/MINUTE/HOUR/DAY/WEEK/MONTH/QUARTER/YEAR interval', 'How many interval boundaries (days, months, …) lie between two dates.'),
  fn('WEEKDAY', 'date and time', 'date, [return type]', 'The day of the week of a date, as a number.'),
  fn('WEEKNUM', 'date and time', 'date, [return type]', 'The week number of a date in its year.'),
  fn('YEARFRAC', 'date and time', 'start date, end date, [basis]', 'The fraction of a year between two dates.'),
  fn('NETWORKDAYS', 'date and time', 'start date, end date, [weekend], [table holidays]', 'The number of working days between two dates.'),
];

const TEXT: FunctionSpec[] = [
  fn('CONCATENATE', 'text', 'text 1, text 2', 'Joins two pieces of text (same as &).'),
  fn('COMBINEVALUES', 'text', 'delimiter, expression, expression*', 'Joins two or more values into one text, with a separator.'),
  fn('EXACT', 'text', 'text 1, text 2', 'TRUE when two texts are exactly the same, capitals included.'),
  fn('FIND', 'text', 'text to find, within text, [start position], [value if not found]', 'Where one text starts inside another (capitals matter).'),
  fn('SEARCH', 'text', 'text to find, within text, [start position], [value if not found]', 'Where one text starts inside another (capitals don\'t matter).'),
  fn('FIXED', 'text', 'number, [decimals], [no commas]', 'Rounds a number and returns it as text.'),
  fn('LEFT', 'text', 'text, [characters]', 'The first characters of a text.'),
  fn('RIGHT', 'text', 'text, [characters]', 'The last characters of a text.'),
  fn('MID', 'text', 'text, start position, characters', 'Characters from the middle of a text.'),
  fn('LEN', 'text', 'text', 'The number of characters in a text.'),
  fn('LOWER', 'text', 'text', 'A text in lower case.'),
  fn('UPPER', 'text', 'text', 'A text in upper case.'),
  fn('TRIM', 'text', 'text', 'A text without extra spaces.'),
  fn('REPLACE', 'text', 'old text, start position, characters, new text', 'Replaces part of a text, by position.'),
  fn('SUBSTITUTE', 'text', 'text, old text, new text, [instance]', 'Replaces a piece of text with another, wherever (or where) it appears.'),
  fn('REPT', 'text', 'text, times', 'A text repeated a number of times.'),
  fn('UNICODE', 'text', 'text', 'The Unicode number of the first character of a text.'),
  fn('VALUE', 'text', 'text', 'Turns a number written as text into a number.'),
];

const MATH: FunctionSpec[] = [
  ...same(['ACOS', 'ACOSH', 'ACOT', 'ACOTH', 'ASIN', 'ASINH', 'ATAN', 'ATANH', 'COS', 'COSH', 'COT', 'COTH', 'SIN', 'SINH', 'TAN', 'TANH'], (name) =>
    fn(name, 'math', 'number', `The ${name.toLowerCase()} of a number (trigonometry).`),
  ),
  fn('DEGREES', 'math', 'angle', 'Converts radians to degrees.'),
  fn('RADIANS', 'math', 'angle', 'Converts degrees to radians.'),
  fn('EVEN', 'math', 'number', 'Rounds up to the nearest even whole number.'),
  fn('ODD', 'math', 'number', 'Rounds up to the nearest odd whole number.'),
  fn('EXP', 'math', 'number', 'e raised to a power.'),
  fn('LN', 'math', 'number', 'The natural logarithm of a number.'),
  fn('LOG10', 'math', 'number', 'The base-10 logarithm of a number.'),
  fn('LOG', 'math', 'number, [base]', 'The logarithm of a number, in a base (10 if not given).'),
  fn('FACT', 'math', 'number', 'The factorial of a number (1 × 2 × … × n).'),
  fn('INT', 'math', 'number', 'Rounds down to a whole number.'),
  fn('SQRT', 'math', 'number', 'The square root of a number.'),
  fn('SQRTPI', 'math', 'number', 'The square root of (number × pi).'),
  fn('SIGN', 'math', 'number', '1, 0 or -1: whether a number is positive, zero or negative.'),
  fn('POWER', 'math', 'number, power', 'A number raised to a power.'),
  fn('MOD', 'math', 'number, divisor', 'The remainder after dividing.'),
  fn('QUOTIENT', 'math', 'numerator, denominator', 'The whole-number part of a division.'),
  fn('ROUNDUP', 'math', 'number, digits', 'Rounds away from zero to a number of digits.'),
  fn('ROUNDDOWN', 'math', 'number, digits', 'Rounds towards zero to a number of digits.'),
  fn('TRUNC', 'math', 'number, [digits]', 'Cuts off the decimals (to a number of digits).'),
  fn('MROUND', 'math', 'number, multiple', 'Rounds to the nearest multiple.'),
  fn('CEILING', 'math', 'number, significance', 'Rounds up to the nearest multiple.'),
  fn('ISO.CEILING', 'math', 'number, [significance]', 'Rounds up to the nearest multiple (the ISO way).'),
  fn('FLOOR', 'math', 'number, significance', 'Rounds down to the nearest multiple.'),
  fn('GCD', 'math', 'number 1, number 2', 'The greatest common divisor of two whole numbers.'),
  fn('LCM', 'math', 'number 1, number 2', 'The least common multiple of two whole numbers.'),
  fn('PI', 'math', '', 'The number pi.'),
  fn('RAND', 'math', '', 'A random number from 0 up to 1 (different each time).'),
  fn('RANDBETWEEN', 'math', 'bottom, top', 'A random whole number between two numbers (different each time).'),
  fn('CURRENCY', 'math', 'value', 'A value as the currency (fixed decimal) type.'),
  fn('CONVERT', 'math', 'expression, kw:BOOLEAN/LOGICAL/CURRENCY/DATETIME/DOUBLE/INTEGER/INT64/STRING data type', 'A value converted to another data type.'),
];

const LOGICAL: FunctionSpec[] = [
  fn('NOT', 'logical', 'logical', 'TRUE becomes FALSE and FALSE becomes TRUE.'),
  fn('IFERROR', 'logical', 'value, value if error', 'The value, or the second value if the first gives an error.'),
  fn('IF.EAGER', 'logical', 'condition, value if true, [value if false]', 'Like IF, but works out both results before choosing (only one is used).'),
  ...same(['BITAND', 'BITOR', 'BITXOR'], (name) => fn(name, 'logical', 'number 1, number 2', `A bitwise ${name.slice(3)} of two numbers.`)),
  fn('BITLSHIFT', 'logical', 'number, shift', 'A number with its bits shifted left.'),
  fn('BITRSHIFT', 'logical', 'number, shift', 'A number with its bits shifted right.'),
];

const INFORMATION: FunctionSpec[] = [
  ...same(['ISERROR', 'ISEVEN', 'ISODD', 'ISNONTEXT', 'ISTEXT', 'ISSTRING', 'ISNUMBER', 'ISNUMERIC', 'ISLOGICAL', 'ISBOOLEAN', 'ISDATETIME', 'ISDECIMAL', 'ISCURRENCY', 'ISDOUBLE', 'ISINTEGER', 'ISINT64'], (name) =>
    fn(name, 'information', 'value', `TRUE when the value ${{ ISERROR: 'is an error', ISEVEN: 'is an even number', ISODD: 'is an odd number', ISNONTEXT: 'is not text (blanks count as not text)', ISTEXT: 'is text', ISSTRING: 'is text', ISNUMBER: 'is a number', ISNUMERIC: 'is a number', ISLOGICAL: 'is TRUE or FALSE', ISBOOLEAN: 'is TRUE or FALSE', ISDATETIME: 'is a date or time', ISDECIMAL: 'is a fixed decimal number', ISCURRENCY: 'is a fixed decimal number', ISDOUBLE: 'is a decimal number', ISINTEGER: 'is a whole number', ISINT64: 'is a whole number' }[name]}.`),
  ),
  fn('ISEMPTY', 'information', 'table table', 'TRUE when a table has no rows (with the filters in effect).'),
  fn('CONTAINS', 'information', 'table table, col column, value, [col column*], [value*]', 'TRUE when a table has a row with these values in these columns.'),
  fn('CONTAINSROW', 'information', 'table table, value, [value*]', 'TRUE when a table has a row with these values (same as IN).'),
  fn('CONTAINSSTRING', 'information', 'within text, text to find', 'TRUE when one text contains another (capitals don\'t matter).'),
  fn('CONTAINSSTRINGEXACT', 'information', 'within text, text to find', 'TRUE when one text contains another (capitals matter).'),
  fn('USERPRINCIPALNAME', 'information', '', 'The signed-in user (their sign-in name).'),
  fn('USERNAME', 'information', '', 'The signed-in user (domain and user name).'),
  fn('USEROBJECTID', 'information', '', "The signed-in user's object ID."),
  fn('USERCULTURE', 'information', '', "The signed-in user's locale, e.g. en-US."),
  fn('CUSTOMDATA', 'information', '', 'The CustomData value of the connection.'),
  fn('COLUMNSTATISTICS', 'information', '', 'A table of statistics about every column in the model.', 'table'),
];

const AGGREGATION: FunctionSpec[] = [
  fn('AVERAGEA', 'aggregation', 'col column', 'Averages a column (TRUE counts as 1, text as 0), using only rows that pass the filters.'),
  fn('MINA', 'aggregation', 'col column', 'The smallest value in a column (TRUE/FALSE count as 1/0), using only rows that pass the filters.'),
  fn('MAXA', 'aggregation', 'col column', 'The largest value in a column (TRUE/FALSE count as 1/0), using only rows that pass the filters.'),
  fn('PRODUCT', 'aggregation', 'col column', 'Multiplies the numbers in a column, using only rows that pass the filters.'),
  fn('DISTINCTCOUNTNOBLANK', 'aggregation', 'col column', 'Counts the different values in a column, not counting BLANK, using only rows that pass the filters.'),
  fn('APPROXIMATEDISTINCTCOUNT', 'aggregation', 'col column', 'An estimate of how many different values a column has (for DirectQuery sources).'),
  iter('COUNTAX', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and counts the non-blank results.'),
  iter('PRODUCTX', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and multiplies the results.'),
];

const STATISTICAL: FunctionSpec[] = [
  fn('MEDIAN', 'statistical', 'col column', 'The middle value of a column, using only rows that pass the filters.'),
  fn('GEOMEAN', 'statistical', 'col column', 'The geometric mean of a column, using only rows that pass the filters.'),
  fn('STDEV.S', 'statistical', 'col column', 'The standard deviation of a column (as a sample), using only rows that pass the filters.'),
  fn('STDEV.P', 'statistical', 'col column', 'The standard deviation of a column (the whole population), using only rows that pass the filters.'),
  fn('VAR.S', 'statistical', 'col column', 'The variance of a column (as a sample), using only rows that pass the filters.'),
  fn('VAR.P', 'statistical', 'col column', 'The variance of a column (the whole population), using only rows that pass the filters.'),
  fn('PERCENTILE.INC', 'statistical', 'col column, k', 'The k-th percentile of a column (k from 0 to 1, inclusive), using only rows that pass the filters.'),
  fn('PERCENTILE.EXC', 'statistical', 'col column, k', 'The k-th percentile of a column (k between 0 and 1, exclusive), using only rows that pass the filters.'),
  iter('MEDIANX', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and returns the middle result.'),
  iter('GEOMEANX', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and returns the geometric mean.'),
  iter('STDEVX.S', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and returns the standard deviation (as a sample).'),
  iter('STDEVX.P', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and returns the standard deviation (the whole population).'),
  iter('VARX.S', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and returns the variance (as a sample).'),
  iter('VARX.P', 'table table, row expression', 'Goes through a table row by row, calculates something for each row, and returns the variance (the whole population).'),
  iter('PERCENTILEX.INC', 'table table, row expression, k', 'Goes through a table row by row, calculates something for each row, and returns the k-th percentile (inclusive).'),
  iter('PERCENTILEX.EXC', 'table table, row expression, k', 'Goes through a table row by row, calculates something for each row, and returns the k-th percentile (exclusive).'),
  fn('RANK.EQ', 'statistical', 'value, col column, [kw:ASC/DESC order]', "Where a value ranks among a column's values (rows that pass the filters)."),
  fn('COMBIN', 'statistical', 'number, chosen', 'The number of combinations (order does not matter).'),
  fn('COMBINA', 'statistical', 'number, chosen', 'The number of combinations, with repetitions.'),
  fn('PERMUT', 'statistical', 'number, chosen', 'The number of permutations (order matters).'),
  fn('BETA.DIST', 'statistical', 'x, alpha, beta, cumulative, [lower bound], [upper bound]', 'The beta distribution.'),
  fn('BETA.INV', 'statistical', 'probability, alpha, beta, [lower bound], [upper bound]', 'The inverse of the beta distribution.'),
  fn('CHISQ.DIST', 'statistical', 'x, degrees of freedom, cumulative', 'The chi-squared distribution.'),
  fn('CHISQ.DIST.RT', 'statistical', 'x, degrees of freedom', 'The right-tailed chi-squared distribution.'),
  fn('CHISQ.INV', 'statistical', 'probability, degrees of freedom', 'The inverse of the chi-squared distribution.'),
  fn('CHISQ.INV.RT', 'statistical', 'probability, degrees of freedom', 'The inverse of the right-tailed chi-squared distribution.'),
  fn('CONFIDENCE.NORM', 'statistical', 'alpha, standard deviation, size', 'The confidence interval for a mean (normal distribution).'),
  fn('CONFIDENCE.T', 'statistical', 'alpha, standard deviation, size', "The confidence interval for a mean (Student's t-distribution)."),
  fn('EXPON.DIST', 'statistical', 'x, lambda, cumulative', 'The exponential distribution.'),
  fn('NORM.DIST', 'statistical', 'x, mean, standard deviation, cumulative', 'The normal distribution.'),
  fn('NORM.INV', 'statistical', 'probability, mean, standard deviation', 'The inverse of the normal distribution.'),
  fn('NORM.S.DIST', 'statistical', 'z, cumulative', 'The standard normal distribution.'),
  fn('NORM.S.INV', 'statistical', 'probability', 'The inverse of the standard normal distribution.'),
  fn('POISSON.DIST', 'statistical', 'x, mean, cumulative', 'The Poisson distribution.'),
  fn('T.DIST', 'statistical', 'x, degrees of freedom, cumulative', "The left-tailed Student's t-distribution."),
  fn('T.DIST.2T', 'statistical', 'x, degrees of freedom', "The two-tailed Student's t-distribution."),
  fn('T.DIST.RT', 'statistical', 'x, degrees of freedom', "The right-tailed Student's t-distribution."),
  fn('T.INV', 'statistical', 'probability, degrees of freedom', "The inverse of the left-tailed Student's t-distribution."),
  fn('T.INV.2T', 'statistical', 'probability, degrees of freedom', "The inverse of the two-tailed Student's t-distribution."),
];

const SECURITY = 'settlement, maturity';
const FINANCIAL: FunctionSpec[] = [
  fn('ACCRINT', 'financial', 'issue, first interest, settlement, rate, par, frequency, [basis], [calculation method]', 'The accrued interest of a security that pays periodic interest.'),
  fn('ACCRINTM', 'financial', 'issue, settlement, rate, par, [basis]', 'The accrued interest of a security that pays interest at maturity.'),
  fn('AMORDEGRC', 'financial', 'cost, date purchased, first period, salvage, period, rate, [basis]', 'Depreciation per accounting period (with a depreciation coefficient).'),
  fn('AMORLINC', 'financial', 'cost, date purchased, first period, salvage, period, rate, [basis]', 'Depreciation per accounting period.'),
  ...same(['COUPDAYBS', 'COUPDAYS', 'COUPDAYSNC', 'COUPNCD', 'COUPNUM', 'COUPPCD'], (name) =>
    fn(name, 'financial', `${SECURITY}, frequency, [basis]`, {
      COUPDAYBS: 'Days from the start of the coupon period to the settlement date.',
      COUPDAYS: 'Days in the coupon period that contains the settlement date.',
      COUPDAYSNC: 'Days from the settlement date to the next coupon date.',
      COUPNCD: 'The next coupon date after the settlement date.',
      COUPNUM: 'The number of coupons payable between settlement and maturity.',
      COUPPCD: 'The previous coupon date before the settlement date.',
    }[name]!),
  ),
  fn('CUMIPMT', 'financial', 'rate, periods, present value, start period, end period, type', 'The interest paid on a loan between two periods.'),
  fn('CUMPRINC', 'financial', 'rate, periods, present value, start period, end period, type', 'The principal paid on a loan between two periods.'),
  fn('DB', 'financial', 'cost, salvage, life, period, [month]', 'Depreciation for a period (fixed-declining balance).'),
  fn('DDB', 'financial', 'cost, salvage, life, period, [factor]', 'Depreciation for a period (double-declining balance).'),
  fn('DISC', 'financial', `${SECURITY}, price, redemption, [basis]`, 'The discount rate of a security.'),
  fn('DOLLARDE', 'financial', 'fractional dollar, fraction', 'A price written as a fraction, as a decimal number.'),
  fn('DOLLARFR', 'financial', 'decimal dollar, fraction', 'A decimal price, written as a fraction.'),
  fn('DURATION', 'financial', `${SECURITY}, coupon, yield, frequency, [basis]`, 'The Macaulay duration of a security.'),
  fn('MDURATION', 'financial', `${SECURITY}, coupon, yield, frequency, [basis]`, 'The modified Macaulay duration of a security.'),
  fn('EFFECT', 'financial', 'nominal rate, periods per year', 'The effective annual interest rate.'),
  fn('NOMINAL', 'financial', 'effective rate, periods per year', 'The nominal annual interest rate.'),
  fn('FV', 'financial', 'rate, periods, payment, [present value], [type]', 'The future value of an investment.'),
  fn('PV', 'financial', 'rate, periods, payment, [future value], [type]', 'The present value of a loan or investment.'),
  fn('PMT', 'financial', 'rate, periods, present value, [future value], [type]', 'The payment per period of a loan.'),
  fn('IPMT', 'financial', 'rate, period, periods, present value, [future value], [type]', 'The interest part of a payment for a period.'),
  fn('PPMT', 'financial', 'rate, period, periods, present value, [future value], [type]', 'The principal part of a payment for a period.'),
  fn('ISPMT', 'financial', 'rate, period, periods, present value', 'The interest paid for a period of a loan with even principal payments.'),
  fn('NPER', 'financial', 'rate, payment, present value, [future value], [type]', 'The number of periods of an investment.'),
  fn('RATE', 'financial', 'periods, payment, present value, [future value], [type], [guess]', 'The interest rate per period.'),
  fn('INTRATE', 'financial', `${SECURITY}, investment, redemption, [basis]`, 'The interest rate of a fully invested security.'),
  fn('RECEIVED', 'financial', `${SECURITY}, investment, discount, [basis]`, 'The amount received at maturity of a fully invested security.'),
  fn('ODDFPRICE', 'financial', `${SECURITY}, issue, first coupon, rate, yield, redemption, frequency, [basis]`, 'The price of a security with an odd first period.'),
  fn('ODDFYIELD', 'financial', `${SECURITY}, issue, first coupon, rate, price, redemption, frequency, [basis]`, 'The yield of a security with an odd first period.'),
  fn('ODDLPRICE', 'financial', `${SECURITY}, last interest, rate, yield, redemption, frequency, [basis]`, 'The price of a security with an odd last period.'),
  fn('ODDLYIELD', 'financial', `${SECURITY}, last interest, rate, price, redemption, frequency, [basis]`, 'The yield of a security with an odd last period.'),
  fn('PDURATION', 'financial', 'rate, present value, future value', 'The number of periods an investment needs to reach a value.'),
  fn('PRICE', 'financial', `${SECURITY}, rate, yield, redemption, frequency, [basis]`, 'The price of a security that pays periodic interest.'),
  fn('PRICEDISC', 'financial', `${SECURITY}, discount, redemption, [basis]`, 'The price of a discounted security.'),
  fn('PRICEMAT', 'financial', `${SECURITY}, issue, rate, yield, [basis]`, 'The price of a security that pays interest at maturity.'),
  fn('RRI', 'financial', 'periods, present value, future value', 'The equivalent interest rate for the growth of an investment.'),
  fn('SLN', 'financial', 'cost, salvage, life', 'Straight-line depreciation for one period.'),
  fn('SYD', 'financial', 'cost, salvage, life, period', "Sum-of-years' digits depreciation for a period."),
  fn('VDB', 'financial', 'cost, salvage, life, start period, end period, [factor], [no switch]', 'Depreciation for any period (declining balance).'),
  fn('TBILLEQ', 'financial', `${SECURITY}, discount`, 'The bond-equivalent yield of a Treasury bill.'),
  fn('TBILLPRICE', 'financial', `${SECURITY}, discount`, 'The price of a Treasury bill.'),
  fn('TBILLYIELD', 'financial', `${SECURITY}, price`, 'The yield of a Treasury bill.'),
  fn('YIELD', 'financial', `${SECURITY}, rate, price, redemption, frequency, [basis]`, 'The yield of a security that pays periodic interest.'),
  fn('YIELDDISC', 'financial', `${SECURITY}, price, redemption, [basis]`, 'The yield of a discounted security.'),
  fn('YIELDMAT', 'financial', `${SECURITY}, issue, rate, price, [basis]`, 'The yield of a security that pays interest at maturity.'),
  iter('XIRR', 'table table, row values, row dates, [guess], [alternate result]', 'Goes through a table row by row (a cash flow per row) and returns the internal rate of return.', 'financial'),
  iter('XNPV', 'table table, row values, row dates, rate', 'Goes through a table row by row (a cash flow per row) and returns the net present value.', 'financial'),
];

const PARENT_AND_CHILD: FunctionSpec[] = [
  fn('PATH', 'parent and child', 'col ID column, col parent column', 'The chain of parents of the current row, as text like "1|4|9" (for parent-child hierarchies).'),
  fn('PATHCONTAINS', 'parent and child', 'path, item', 'TRUE when a PATH text contains an item.'),
  fn('PATHITEM', 'parent and child', 'path, position, [type]', 'The item at a position in a PATH text, from the start.'),
  fn('PATHITEMREVERSE', 'parent and child', 'path, position, [type]', 'The item at a position in a PATH text, from the end.'),
  fn('PATHLENGTH', 'parent and child', 'path', 'The number of items in a PATH text.'),
];

const OTHER: FunctionSpec[] = [
  fn('ERROR', 'other', 'message', 'Stops the calculation with an error message.'),
  fn('EVALUATEANDLOG', 'other', 'value, [label], [max rows]', 'Returns the value unchanged, and logs it for debugging (DAX Evaluation Log).'),
  fn('TOCSV', 'other', 'table table, [max rows], [delimiter], [include headers]', 'A table written out as CSV text.'),
  fn('TOJSON', 'other', 'table table, [max rows]', 'A table written out as JSON text.'),
];

export const PLAIN_FUNCTIONS: readonly FunctionSpec[] = [
  ...DATE_AND_TIME,
  ...TEXT,
  ...MATH,
  ...LOGICAL,
  ...INFORMATION,
  ...AGGREGATION,
  ...STATISTICAL,
  ...FINANCIAL,
  ...PARENT_AND_CHILD,
  ...OTHER,
];
