export type Role = "ADMIN" | "ORDER_TAKER" | "CASHIER";

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  unitPrice: string;
}

export interface SaleItem {
  id: string;
  itemId: string;
  quantity: number;
  unitPrice: string;
  item: InventoryItem;
}

export interface BillingItem {
  id: string;
  description: string;
  amount: string;
  category?: string;
}

export interface SaleNote {
  id: string;
  authorId?: string;
  note: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  method: "CASH" | "INSURANCE";
  amount: string;
  amountPaid: string;
  insuranceProvider?: string;
  claimNo?: string;
  claimStatus?: "SUBMITTED" | "APPROVED" | "PARTIALLY_PAID" | "PAID" | "REJECTED";
  paidAt?: string;
  installments?: { id: string; amount: string; recordedAt: string }[];
}

export interface Sale {
  id: string;
  saleNo: string;
  customerName?: string;
  customerPhone?: string;
  status: "CASHIER" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  completedAt?: string;
  items: SaleItem[];
  billingItems: BillingItem[];
  payment?: Payment;
  notes?: SaleNote[];
}

export interface QueueEntry {
  id: string;
  saleId: string;
  department: "CASHIER";
  status: "WAITING" | "CLAIMED" | "COMPLETED" | "CANCELLED";
  claimedById?: string;
  sale: Sale;
}
