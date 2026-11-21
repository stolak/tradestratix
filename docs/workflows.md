# Core Workflows

## Stock transfer (target design)

1. Request → 2. Approve → 3. Dispatch (in transit) → 4. Receive → 5. Histories on both sides

## Purchase → inventory → AP (target)

PO → GRN → stock + valuation → supplier liability + GL

## Sale → inventory → AR/cash + COGS (target)

Invoice/POS → stock out → revenue + COGS journals → commission hooks

## Payroll

Config (components / chart / statutory) → assign employee pay → **compute** (draft) → **approve** → **post** (component GL) → **pay** (bank/cash)  
Sales commission (optional): accrued commissions inject as earning on compute; marked paid on pay.  
SoD: approver ≠ creator; poster ≠ approver (bypassed for admin / `payroll.*`).
