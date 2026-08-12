# DHS Pharmacy

A lightweight, standalone inventory & point-of-sale system for a
pharmacy — extracted from the full Digital Health Solutions hospital
system, keeping only the stock, sale, and cashier pipeline.

## Roles
- **Order Taker** — selects items for a customer and fulfills the order
  in one step (dispensing happens immediately); sends it to the Cashier
  queue.
- **Cashier** — claims sales from the shared queue, captures payment
  (cash or insurance, including partial/installment insurance payments),
  can add ad-hoc charges.
- **Admin** — staff management, audit log, full reports.

## Deployment

See `WINDOWS_ONPREM_SETUP.md` for a full on-premise Windows walkthrough
(no cloud dependency). The same codebase also deploys to Render/Vercel
using the same pattern as the main DHS system, if a cloud option is
wanted later.
