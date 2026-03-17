'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createManualBookingAction, type ManualBookingActionState } from '@/app/(office)/actions';
import { splitAmountEvenly } from '@/lib/commerce';

type PackageOption = {
  id: string;
  title: string;
  currency: string;
  priceFrom: number;
};

type DepartureOption = {
  id: string;
  code: string;
  packageId: string;
  packageTitle: string;
  startDate: string;
};

type VendorOption = {
  id: string;
  name: string;
};

type ManualLineItem = {
  id: string;
  itemName: string;
  quantity: number;
  pricePerUnit: number;
  dateFrom: string;
  dateTo: string;
  specialRequests: string;
};

type DirectCostRow = {
  id: string;
  vendorId: string;
  category: string;
  description: string;
  amount: number;
  notes: string;
};

type OwnerDistributionRow = {
  id: string;
  recipientName: string;
  amount: number;
  notes: string;
  paidAt: string;
};

type ManualBookingFormProps = {
  packages: PackageOption[];
  departures: DepartureOption[];
  vendors: VendorOption[];
};

const initialActionState: ManualBookingActionState = {
  error: null,
};

function createRowId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button-primary w-full sm:w-auto" disabled={pending}>
      {pending ? 'Saving manual booking...' : 'Save manual booking'}
    </button>
  );
}

export function ManualBookingForm({ packages, departures, vendors }: ManualBookingFormProps) {
  const [state, formAction] = useActionState(createManualBookingAction, initialActionState);
  const [saleDate, setSaleDate] = useState(todayInputValue);
  const [tripTitle, setTripTitle] = useState('');
  const [paymentMode, setPaymentMode] = useState<'unpaid' | 'deposit' | 'fully_paid'>('unpaid');
  const [paymentReceivedNow, setPaymentReceivedNow] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [currency, setCurrency] = useState<'KES' | 'USD' | 'TZS'>('KES');
  const [catalogPackageId, setCatalogPackageId] = useState('');
  const [departureId, setDepartureId] = useState('');
  const [lineItems, setLineItems] = useState<ManualLineItem[]>([
    {
      id: createRowId('item'),
      itemName: '',
      quantity: 1,
      pricePerUnit: 0,
      dateFrom: '',
      dateTo: '',
      specialRequests: '',
    },
  ]);
  const [directCosts, setDirectCosts] = useState<DirectCostRow[]>([
    {
      id: createRowId('cost'),
      vendorId: '',
      category: 'Accommodation',
      description: '',
      amount: 0,
      notes: '',
    },
  ]);
  const [ownerDistributions, setOwnerDistributions] = useState<OwnerDistributionRow[]>([
    { id: createRowId('owner'), recipientName: 'Owner 1', amount: 0, notes: '', paidAt: todayInputValue() },
    { id: createRowId('owner'), recipientName: 'Owner 2', amount: 0, notes: '', paidAt: todayInputValue() },
    { id: createRowId('owner'), recipientName: 'Owner 3', amount: 0, notes: '', paidAt: todayInputValue() },
  ]);
  const [distributionDirty, setDistributionDirty] = useState(false);

  const activeDepartures = catalogPackageId
    ? departures.filter((departure) => departure.packageId === catalogPackageId)
    : departures;

  const effectivePaymentReceivedNow = paymentMode === 'fully_paid' ? true : paymentMode === 'deposit' ? paymentReceivedNow : false;
  const filteredLineItems = lineItems.filter((item) => item.itemName.trim() || item.pricePerUnit > 0 || item.quantity > 1);
  const filteredDirectCosts = directCosts.filter(
    (cost) => cost.description.trim() || cost.amount > 0 || cost.notes.trim() || cost.vendorId || cost.category.trim() !== 'Accommodation'
  );
  const itemsTotal = filteredLineItems.reduce((sum, item) => sum + item.quantity * item.pricePerUnit, 0);
  const directCostTotal = filteredDirectCosts.reduce((sum, item) => sum + item.amount, 0);
  const operatingMargin = itemsTotal - directCostTotal;
  const autoDistributionValues = splitAmountEvenly(Math.max(operatingMargin, 0), ownerDistributions.length);
  const displayedOwnerDistributions = distributionDirty
    ? ownerDistributions
    : ownerDistributions.map((distribution, index) => ({
        ...distribution,
        amount: autoDistributionValues[index] || 0,
        paidAt: distribution.paidAt || saleDate,
      }));
  const filteredOwnerDistributions = displayedOwnerDistributions.filter((distribution) => distribution.amount > 0);
  const ownerDistributionTotal = filteredOwnerDistributions.reduce((sum, item) => sum + item.amount, 0);
  const undistributedMargin = operatingMargin - ownerDistributionTotal;

  function updateOwnerDistributions(
    updater: (current: OwnerDistributionRow[]) => OwnerDistributionRow[],
    nextDistributionDirty = distributionDirty
  ) {
    const source = distributionDirty ? ownerDistributions : displayedOwnerDistributions;
    setOwnerDistributions(updater(source));
    setDistributionDirty(nextDistributionDirty);
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="depositAmount" value={depositAmount} />
      <input type="hidden" name="paymentReceivedNow" value={effectivePaymentReceivedNow ? 'true' : 'false'} />
      <input
        type="hidden"
        name="itemsJson"
        value={JSON.stringify(
          filteredLineItems.map((item) => ({
            itemName: item.itemName.trim(),
            quantity: item.quantity,
            pricePerUnit: item.pricePerUnit,
            dateFrom: item.dateFrom || undefined,
            dateTo: item.dateTo || undefined,
            specialRequests: item.specialRequests || undefined,
          }))
        )}
      />
      <input
        type="hidden"
        name="directCostsJson"
        value={JSON.stringify(
          filteredDirectCosts.map((cost) => ({
            vendorId: cost.vendorId || undefined,
            category: cost.category.trim(),
            description: cost.description.trim(),
            amount: cost.amount,
            notes: cost.notes || undefined,
          }))
        )}
      />
      <input
        type="hidden"
        name="ownerDistributionsJson"
        value={JSON.stringify(
          filteredOwnerDistributions.map((distribution) => ({
            recipientName: distribution.recipientName.trim(),
            amount: distribution.amount,
            notes: distribution.notes || undefined,
            paidAt: distribution.paidAt || undefined,
          }))
        )}
      />

      <section className="panel p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">Booking basics</p>
          <h2 className="font-display text-3xl">Capture the off-website sale</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Sale date</span>
            <input name="saleDate" type="date" className="input" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} required />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Journey title</span>
            <input name="tripTitle" className="input" value={tripTitle} onChange={(event) => setTripTitle(event.target.value)} placeholder="Leisure Lodge stay" required />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Link package</span>
            <select
              name="catalogPackageId"
              className="select"
              value={catalogPackageId}
              onChange={(event) => {
                const nextPackageId = event.target.value;
                setCatalogPackageId(nextPackageId);

                const selectedDeparture = departures.find((departure) => departure.id === departureId);
                if (selectedDeparture && nextPackageId && selectedDeparture.packageId !== nextPackageId) {
                  setDepartureId('');
                }
              }}
            >
              <option value="">Custom / not from package catalog</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.title}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Link departure</span>
            <select name="departureId" className="select" value={departureId} onChange={(event) => setDepartureId(event.target.value)}>
              <option value="">No departure linked</option>
              {activeDepartures.map((departure) => (
                <option key={departure.id} value={departure.id}>
                  {departure.code} - {departure.packageTitle} - {new Date(departure.startDate).toLocaleDateString('en-KE')}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">Customer and guests</p>
          <h2 className="font-display text-3xl">Store who this booking belongs to</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 xl:col-span-2">
            <span className="text-sm font-medium text-foreground">Lead traveler</span>
            <input name="leadFullName" className="input" placeholder="Basil Thembi" required />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Email</span>
            <input name="leadEmail" type="email" className="input" placeholder="traveler@email.com" required />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Phone</span>
            <input name="leadPhone" className="input" placeholder="+254..." />
          </label>
          <label className="space-y-2 md:max-w-[180px]">
            <span className="text-sm font-medium text-foreground">Guests</span>
            <input name="guestCount" type="number" min="1" step="1" className="input" defaultValue="1" required />
          </label>
          <label className="space-y-2 md:col-span-2 xl:col-span-3">
            <span className="text-sm font-medium text-foreground">Notes</span>
            <textarea name="tripNotes" className="textarea" placeholder="Room preference, booking source, internal notes..." />
          </label>
        </div>
      </section>

      <section className="panel p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Revenue setup</p>
            <h2 className="font-display text-3xl">Define what was sold and how cash is moving</h2>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              setLineItems((current) => [
                ...current,
                {
                  id: createRowId('item'),
                  itemName: '',
                  quantity: 1,
                  pricePerUnit: 0,
                  dateFrom: '',
                  dateTo: '',
                  specialRequests: '',
                },
              ])
            }
          >
            Add sale item
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Currency</span>
            <select name="currency" className="select" value={currency} onChange={(event) => setCurrency(event.target.value as 'KES' | 'USD' | 'TZS')}>
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="TZS">TZS</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Payment mode</span>
            <select
              name="paymentMode"
              className="select"
              value={paymentMode}
              onChange={(event) => {
                const nextPaymentMode = event.target.value as 'unpaid' | 'deposit' | 'fully_paid';
                setPaymentMode(nextPaymentMode);

                if (nextPaymentMode === 'unpaid') {
                  setPaymentReceivedNow(false);
                  setDepositAmount('');
                }

                if (nextPaymentMode === 'fully_paid') {
                  setPaymentReceivedNow(true);
                }
              }}
            >
              <option value="unpaid">Unpaid</option>
              <option value="deposit">Deposit</option>
              <option value="fully_paid">Fully paid</option>
            </select>
          </label>
          {paymentMode === 'deposit' && (
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Deposit amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                placeholder="0.00"
                required
              />
            </label>
          )}
          <div className="rounded-[24px] border border-line bg-white/60 p-4">
            <p className="eyebrow mb-2">Quoted total</p>
            <p className="font-display text-3xl">
              {currency} {itemsTotal.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="rounded-[24px] border border-line bg-white/60 p-4">
            <p className="eyebrow mb-2">Cash status</p>
            <p className="text-sm text-muted">
              {paymentMode === 'unpaid'
                ? 'Invoices only.'
                : paymentMode === 'fully_paid'
                  ? 'Invoice plus immediate receipt.'
                  : effectivePaymentReceivedNow
                    ? 'Deposit invoice plus received payment.'
                    : 'Deposit and balance invoices only.'}
            </p>
          </div>
        </div>

        {paymentMode === 'deposit' && (
          <label className="mt-4 flex items-center gap-3 rounded-[24px] border border-line bg-white/60 px-4 py-3">
            <input type="checkbox" checked={paymentReceivedNow} onChange={(event) => setPaymentReceivedNow(event.target.checked)} />
            <span className="text-sm text-foreground">Mark the deposit as already received</span>
          </label>
        )}

        {(paymentMode === 'fully_paid' || (paymentMode === 'deposit' && effectivePaymentReceivedNow)) && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Payment channel</span>
              <select name="paymentChannel" className="select" defaultValue="BANK_TRANSFER">
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="MPESA_MANUAL">Direct M-Pesa</option>
                <option value="CASH">Cash</option>
                <option value="OFFICE_CARD">Office card</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Reference</span>
              <input name="paymentReference" className="input" placeholder="Confirmation code" />
            </label>
            <label className="space-y-2 md:col-span-3">
              <span className="text-sm font-medium text-foreground">Payment notes</span>
              <textarea name="paymentNotes" className="textarea" placeholder="Optional receipt notes..." />
            </label>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {lineItems.map((item, index) => (
            <div key={item.id} className="rounded-[24px] border border-line bg-white/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="font-medium text-foreground">Sale line {index + 1}</p>
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    className="text-sm text-muted underline"
                    onClick={() => setLineItems((current) => current.filter((currentItem) => currentItem.id !== item.id))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <label className="space-y-2 xl:col-span-2">
                  <span className="text-sm font-medium text-foreground">Item name</span>
                  <input
                    className="input"
                    value={item.itemName}
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((currentItem) =>
                          currentItem.id === item.id ? { ...currentItem, itemName: event.target.value } : currentItem
                        )
                      )
                    }
                    placeholder={index === 0 ? tripTitle || 'Hotel stay' : 'Add-on service'}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Quantity</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="input"
                    value={item.quantity}
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((currentItem) =>
                          currentItem.id === item.id ? { ...currentItem, quantity: Number(event.target.value) || 1 } : currentItem
                        )
                      )
                    }
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Unit price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={item.pricePerUnit}
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((currentItem) =>
                          currentItem.id === item.id ? { ...currentItem, pricePerUnit: Number(event.target.value) || 0 } : currentItem
                        )
                      )
                    }
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">From</span>
                  <input
                    type="date"
                    className="input"
                    value={item.dateFrom}
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, dateFrom: event.target.value } : currentItem))
                      )
                    }
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">To</span>
                  <input
                    type="date"
                    className="input"
                    value={item.dateTo}
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, dateTo: event.target.value } : currentItem))
                      )
                    }
                  />
                </label>
                <label className="space-y-2 md:col-span-2 xl:col-span-6">
                  <span className="text-sm font-medium text-foreground">Special requests</span>
                  <textarea
                    className="textarea"
                    value={item.specialRequests}
                    onChange={(event) =>
                      setLineItems((current) =>
                        current.map((currentItem) =>
                          currentItem.id === item.id ? { ...currentItem, specialRequests: event.target.value } : currentItem
                        )
                      )
                    }
                    placeholder="Optional stay or traveler notes..."
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Direct costs</p>
            <h2 className="font-display text-3xl">Attach supplier spend to the booking</h2>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              setDirectCosts((current) => [
                ...current,
                {
                  id: createRowId('cost'),
                  vendorId: '',
                  category: 'Operations',
                  description: '',
                  amount: 0,
                  notes: '',
                },
              ])
            }
          >
            Add cost line
          </button>
        </div>
        <div className="space-y-4">
          {directCosts.map((cost, index) => (
            <div key={cost.id} className="rounded-[24px] border border-line bg-white/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="font-medium text-foreground">Cost line {index + 1}</p>
                {directCosts.length > 1 && (
                  <button
                    type="button"
                    className="text-sm text-muted underline"
                    onClick={() => setDirectCosts((current) => current.filter((currentCost) => currentCost.id !== cost.id))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Vendor</span>
                  <select
                    className="select"
                    value={cost.vendorId}
                    onChange={(event) =>
                      setDirectCosts((current) =>
                        current.map((currentCost) => (currentCost.id === cost.id ? { ...currentCost, vendorId: event.target.value } : currentCost))
                      )
                    }
                  >
                    <option value="">No vendor linked</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Category</span>
                  <input
                    className="input"
                    value={cost.category}
                    onChange={(event) =>
                      setDirectCosts((current) =>
                        current.map((currentCost) => (currentCost.id === cost.id ? { ...currentCost, category: event.target.value } : currentCost))
                      )
                    }
                    placeholder="Accommodation"
                  />
                </label>
                <label className="space-y-2 xl:col-span-2">
                  <span className="text-sm font-medium text-foreground">Description</span>
                  <input
                    className="input"
                    value={cost.description}
                    onChange={(event) =>
                      setDirectCosts((current) =>
                        current.map((currentCost) =>
                          currentCost.id === cost.id ? { ...currentCost, description: event.target.value } : currentCost
                        )
                      )
                    }
                    placeholder="Leisure Lodge room cost"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={cost.amount}
                    onChange={(event) =>
                      setDirectCosts((current) =>
                        current.map((currentCost) =>
                          currentCost.id === cost.id ? { ...currentCost, amount: Number(event.target.value) || 0 } : currentCost
                        )
                      )
                    }
                  />
                </label>
                <label className="space-y-2 md:col-span-2 xl:col-span-5">
                  <span className="text-sm font-medium text-foreground">Notes</span>
                  <textarea
                    className="textarea"
                    value={cost.notes}
                    onChange={(event) =>
                      setDirectCosts((current) =>
                        current.map((currentCost) => (currentCost.id === cost.id ? { ...currentCost, notes: event.target.value } : currentCost))
                      )
                    }
                    placeholder="Optional supplier notes..."
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Owner distributions</p>
            <h2 className="font-display text-3xl">Track partner payouts separately from expenses</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setDistributionDirty(false);
              }}
            >
              Reset equal split
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                updateOwnerDistributions((current) => [
                  ...current,
                  {
                    id: createRowId('owner'),
                    recipientName: `Owner ${current.length + 1}`,
                    amount: 0,
                    notes: '',
                    paidAt: saleDate,
                  },
                ]);
              }}
            >
              Add owner row
            </button>
          </div>
        </div>
        <div className="space-y-4">
          {displayedOwnerDistributions.map((distribution, index) => (
            <div key={distribution.id} className="rounded-[24px] border border-line bg-white/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="font-medium text-foreground">Owner row {index + 1}</p>
                {displayedOwnerDistributions.length > 1 && (
                  <button
                    type="button"
                    className="text-sm text-muted underline"
                    onClick={() => {
                      updateOwnerDistributions(
                        (current) => current.filter((currentDistribution) => currentDistribution.id !== distribution.id)
                      );
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Recipient name</span>
                  <input
                    className="input"
                    value={distribution.recipientName}
                    onChange={(event) => {
                      updateOwnerDistributions((current) =>
                        current.map((currentDistribution) =>
                          currentDistribution.id === distribution.id
                            ? { ...currentDistribution, recipientName: event.target.value }
                            : currentDistribution
                        )
                      );
                    }}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={distribution.amount}
                    onChange={(event) => {
                      updateOwnerDistributions((current) =>
                        current.map((currentDistribution) =>
                          currentDistribution.id === distribution.id
                            ? { ...currentDistribution, amount: Number(event.target.value) || 0 }
                            : currentDistribution
                        )
                      , true);
                    }}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Paid on</span>
                  <input
                    type="date"
                    className="input"
                    value={distribution.paidAt}
                    onChange={(event) => {
                      updateOwnerDistributions((current) =>
                        current.map((currentDistribution) =>
                          currentDistribution.id === distribution.id
                            ? { ...currentDistribution, paidAt: event.target.value }
                            : currentDistribution
                        )
                      , true);
                    }}
                  />
                </label>
                <label className="space-y-2 md:col-span-2 xl:col-span-4">
                  <span className="text-sm font-medium text-foreground">Notes</span>
                  <textarea
                    className="textarea"
                    value={distribution.notes}
                    onChange={(event) => {
                      updateOwnerDistributions((current) =>
                        current.map((currentDistribution) =>
                          currentDistribution.id === distribution.id
                            ? { ...currentDistribution, notes: event.target.value }
                            : currentDistribution
                        )
                      , true);
                    }}
                    placeholder="Optional payout note..."
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-strong p-6">
        <div className="mb-5">
          <p className="eyebrow mb-2">Review summary</p>
          <h2 className="font-display text-3xl">Check the booking economics before posting</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <article className="rounded-[24px] border border-line bg-white/70 p-4">
            <p className="eyebrow mb-2">Revenue</p>
            <p className="font-display text-3xl">{currency} {itemsTotal.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</p>
          </article>
          <article className="rounded-[24px] border border-line bg-white/70 p-4">
            <p className="eyebrow mb-2">Direct costs</p>
            <p className="font-display text-3xl">{currency} {directCostTotal.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</p>
          </article>
          <article className="rounded-[24px] border border-line bg-white/70 p-4">
            <p className="eyebrow mb-2">Operating margin</p>
            <p className="font-display text-3xl">{currency} {operatingMargin.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</p>
          </article>
          <article className="rounded-[24px] border border-line bg-white/70 p-4">
            <p className="eyebrow mb-2">Owner payouts</p>
            <p className="font-display text-3xl">{currency} {ownerDistributionTotal.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</p>
          </article>
          <article className="rounded-[24px] border border-line bg-white/70 p-4">
            <p className="eyebrow mb-2">Remaining</p>
            <p className="font-display text-3xl">{currency} {undistributedMargin.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</p>
          </article>
        </div>

        {state.error && (
          <div className="mt-5 rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.error}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            This creates the booking, quote, invoice schedule, any received payment, direct supplier costs, and owner distributions in one pass.
          </p>
          <SubmitButton />
        </div>
      </section>
    </form>
  );
}
