# Testing Guide

Critical scenarios (to be automated progressively):

1. Purchasing → inventory → AP → GL  
2. Retail POS → stock → revenue/COGS  
3. Credit sale → partial payment  
4. Expiry / FEFO  
5. Warehouse transfer + in-transit  
6. Payroll posting  
7. Asset depreciation  
8. Tenant isolation  
9. Branch restrictions  

Run Phase 1 smoke: start server, login, CRUD branch/warehouse, list chart of accounts.
