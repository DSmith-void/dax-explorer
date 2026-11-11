/**
 * Built-in sample measures.
 *
 * All samples use a SYNTHETIC model (Sales, Product, Customer, Date, Plant).
 * Never add real company measures, table names, or data here.
 */
export interface SampleMeasure {
  id: string;
  title: string;
  /** One-line hint about the DAX concept the sample illustrates. */
  concept: string;
  expression: string;
}

export const SAMPLE_MEASURES: readonly SampleMeasure[] = [
  {
    id: 'percent-of-total',
    title: 'Sales Percent of Total',
    concept: 'The top and bottom of the division use different filters: the bottom ignores Category, giving the total for all categories.',
    expression: `Sales Percent of Total =
DIVIDE(
    [Total Sales],
    CALCULATE(
        [Total Sales],
        REMOVEFILTERS(Product[Category])
    )
)`,
  },
  {
    id: 'average-per-customer',
    title: 'Average Sales per Customer',
    concept: 'AVERAGEX goes customer by customer, and [Total Sales] is calculated for just that customer each time.',
    expression: `Average Sales per Customer =
AVERAGEX(
    VALUES(Customer[Customer Key]),
    [Total Sales]
)`,
  },
  {
    id: 'plant-share-with-vars',
    title: 'Plant Share (with variables)',
    concept: 'Each variable is calculated once, where it is written: one with the report\'s filters, one with all plants.',
    expression: `Plant Share =
VAR CurrentPlantSales = [Total Sales]
VAR AllPlantSales =
    CALCULATE(
        [Total Sales],
        ALL(Plant)
    )
RETURN
    DIVIDE(CurrentPlantSales, AllPlantSales)`,
  },
  {
    id: 'top-plant',
    title: 'Top Plant by Sales',
    concept: 'TOPN and CONCATENATEX both go plant by plant, and [Total Sales] is calculated for just that plant each time.',
    expression: `Top Plant by Sales =
VAR TopPlant =
    TOPN(
        1,
        FILTER(
            VALUES(Plant[Plant Name]),
            Plant[Plant Name] <> "Unknown"
        ),
        [Total Sales], DESC
    )
RETURN
    CONCATENATEX(
        TopPlant,
        Plant[Plant Name] & ": " & FORMAT([Total Sales], "#,##0")
    )`,
  },
  {
    id: 'sales-by-ship-date',
    title: 'Sales by Ship Date',
    concept: 'USERELATIONSHIP switches Sales to Date from the order date to the (normally inactive) ship date, just inside this CALCULATE.',
    expression: `Sales by Ship Date =
CALCULATE(
    [Total Sales],
    USERELATIONSHIP(Sales[Ship Date], 'Date'[Date])
)`,
  },
  {
    id: 'customers-who-bought',
    title: 'Customers Who Bought',
    concept: 'CROSSFILTER BOTH lets filters on products flow back through Sales to Customer, so only customers who bought them are counted.',
    expression: `Customers Who Bought =
CALCULATE(
    COUNTROWS(Customer),
    CROSSFILTER(Sales[Customer Key], Customer[Customer Key], BOTH)
)`,
  },
  {
    id: 'featured-category-sales',
    title: 'Featured Category Sales',
    concept: 'TREATAS applies a list of values as a filter on Product[Category], as if it came through a relationship.',
    expression: `Featured Category Sales =
CALCULATE(
    [Total Sales],
    TREATAS({"Widgets", "Gadgets"}, Product[Category])
)`,
  },
  {
    id: 'best-plant-order-value',
    title: 'Best Plant Order Value',
    concept: 'A measure that calls a measure that calls measures: step into [Average Order Value] to see what it does for one plant.',
    expression: `Best Plant Order Value =
MAXX(
    VALUES(Plant[Plant Name]),
    [Average Order Value]
)`,
  },
];

/**
 * The measures the examples call, so they can be stepped into without a connected report.
 * Same names and code as in the Initech sample report.
 */
export const SAMPLE_BASE_MEASURES: readonly { name: string; expression: string }[] = [
  { name: 'Total Sales', expression: 'SUM(Sales[Amount])' },
  { name: 'Total Quantity', expression: 'SUM(Sales[Quantity])' },
  { name: 'Order Count', expression: 'COUNTROWS(Sales)' },
  { name: 'Average Order Value', expression: 'DIVIDE([Total Sales], [Order Count])' },
];

/** The code of a built-in measure (an example's measure or one they call), by name, ignoring case. */
export function sampleDefinition(name: string): { name: string; expression: string } | undefined {
  const key = name.toLowerCase();
  const base = SAMPLE_BASE_MEASURES.find((m) => m.name.toLowerCase() === key);
  if (base) return base;
  for (const sample of SAMPLE_MEASURES) {
    const match = /^([^=\n]+?)\s*=\s*\n([\s\S]*)$/.exec(sample.expression);
    if (match && match[1].toLowerCase() === key) return { name: match[1], expression: match[2] };
  }
  return undefined;
}
