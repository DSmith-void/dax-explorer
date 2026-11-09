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
];
