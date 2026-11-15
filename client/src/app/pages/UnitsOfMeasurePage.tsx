import React from 'react';
import { ProductsPage } from './ProductsPage';

/** @deprecated Units live under Products → Catalog → Units. */
export const UnitsOfMeasurePage: React.FC = () => (
  <ProductsPage initialTab="catalog" catalogKind="units" />
);
