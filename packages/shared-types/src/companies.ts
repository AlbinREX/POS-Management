export type ContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'TERMINATED';
export type BillingCycle = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';
export type CompanyEntryKind = 'CHARGE' | 'PAYMENT' | 'PAYMENT_REVERSAL';
export interface CompanyRecord {
  id: string;
  name: string;
  businessNumber: string;
  taxNumber: string;
  address: string;
  phone: string;
  email: string;
  contactPerson: string;
  active: boolean;
  deletedAt: string | null;
  version: number;
}
export interface ContractRecord {
  id: string;
  companyId: string;
  companyName: string;
  contractNumber: string;
  startDate: string;
  endDate: string | null;
  creditLimit: string;
  discountPercentage: string;
  paymentTermsDays: number;
  billingCycle: BillingCycle;
  notes: string;
  status: ContractStatus;
  currency: string;
  version: number;
  createdAt: string;
}
export interface CompanyEmployeeRecord {
  id: string;
  companyId: string;
  name: string;
  code: string;
  email: string;
  phone: string;
  active: boolean;
  deletedAt: string | null;
  version: number;
  consumedTotal: string;
  orderCount: number;
}
export interface CompanyEntryRecord {
  id: string;
  kind: CompanyEntryKind;
  amount: string;
  orderId: string | null;
  orderNumber: string | null;
  employeeId: string | null;
  employeeName: string | null;
  method: string | null;
  reference: string | null;
  reason: string;
  reversesId: string | null;
  reversed: boolean;
  createdAt: string;
  userName: string;
}
export interface CompanyAccount {
  companyId: string;
  currency: string;
  contractId: string | null;
  contractStatus: ContractStatus | null;
  creditLimit: string;
  charged: string;
  paid: string;
  balance: string;
  available: string;
  lastChargeAt: string | null;
  orderCount: number;
  items: CompanyEntryRecord[];
  hasMore: boolean;
}
export interface StatementLineRecord {
  id: string;
  entryId: string;
  kind: CompanyEntryKind;
  amount: string;
  orderNumber: string | null;
  employeeName: string | null;
  reason: string;
  occurredAt: string;
}
export interface StatementRecord {
  id: string;
  companyId: string;
  companyName: string;
  contractId: string;
  contractNumber: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  currency: string;
  openingBalance: string;
  charges: string;
  payments: string;
  closingBalance: string;
  createdAt: string;
  issuedBy: string;
  items: StatementLineRecord[];
}
