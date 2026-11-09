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
    concept: 'CALCULATE removing a filter: numerator and denominator see different filter contexts.',
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
    concept: 'An iterator creates row context; the measure reference triggers context transition.',
    expression: `Average Sales per Customer =
AVERAGEX(
    VALUES(Customer[Customer Key]),
    [Total Sales]
)`,
  },
  {
    id: 'plant-share-with-vars',
    title: 'Plant Share (with variables)',
    concept: 'Variables are evaluated once, in the context where they are defined.',
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
];
