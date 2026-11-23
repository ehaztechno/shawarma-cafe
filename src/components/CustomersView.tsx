import React, { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { formatCurrency, formatTimestamp } from '../lib/permissions';
import { upsertCatalogDocument } from '../lib/posService';
import { Customer } from '../types/pos';

export const CustomersView: React.FC = () => {
  const {
    customers,
    orders,
    settings,
    firebaseUser,
    activeStaffUids,
    notify,
    setCartCustomerId,
    setCartCustomerName,
    setCartCustomerPhone,
    setCartDeliveryAddress,
    setActiveSection,
  } = usePos();

  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const sym = settings.currencySymbol || '₹';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.phone.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const customerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return orders.filter(
      (o) =>
        o.customerId === selectedCustomer.id ||
        (selectedCustomer.phone && o.customerPhone === selectedCustomer.phone)
    );
  }, [orders, selectedCustomer]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !name.trim() || phone.trim().length < 5) return;
    const id = `cust_${Date.now()}`;
    try {
      const nowIso = new Date().toISOString();
      await upsertCatalogDocument('customers', id, {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        totalOrders: 0,
        totalSpent: 0,
        lastOrderAt: nowIso,
        staffUids: activeStaffUids,
      });
      setName('');
      setPhone('');
      setAddress('');
      notify('Customer added to CRM.', 'success');
    } catch (err: any) {
      notify(err?.message || 'Unable to add customer.', 'error');
    }
  };

  const startOrderForCustomer = (c: Customer) => {
    setCartCustomerId(c.id);
    setCartCustomerName(c.name);
    setCartCustomerPhone(c.phone);
    setCartDeliveryAddress(c.address || '');
    setActiveSection('pos');
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
            Customer CRM
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Search by mobile number to view spending history and repeat orders
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mobile or name..."
            className="w-full min-h-[38px] pl-9 pr-3 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 text-xs">
        <form
          onSubmit={handleAddCustomer}
          className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-5 space-y-3 h-fit"
        >
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-orange-600" />
            Add New Customer
          </h3>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full Name *"
            className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
          />
          <input
            type="tel"
            required
            minLength={5}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Mobile Number *"
            className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
          />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Delivery Address"
            className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
          />
          <button
            type="submit"
            className="w-full min-h-[40px] rounded-lg bg-orange-600 text-white font-semibold hover:bg-orange-700 cursor-pointer"
          >
            Save Customer
          </button>
        </form>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-stone-50 dark:bg-stone-800/50 text-stone-500 border-b border-stone-200 dark:border-stone-800">
                  <tr>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Mobile</th>
                    <th className="py-3 px-4 text-right">Orders</th>
                    <th className="py-3 px-4 text-right">Total Spent</th>
                    <th className="py-3 px-4">Last Order</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedCustomer(c)}
                      className="hover:bg-stone-50 dark:hover:bg-stone-800/40 cursor-pointer"
                    >
                      <td className="py-3 px-4 font-semibold">{c.name}</td>
                      <td className="py-3 px-4 font-mono-num">{c.phone}</td>
                      <td className="py-3 px-4 text-right font-mono-num">{c.totalOrders}</td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold">
                        {formatCurrency(c.totalSpent, sym)}
                      </td>
                      <td className="py-3 px-4 text-stone-500">
                        {formatTimestamp(c.lastOrderAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startOrderForCustomer(c);
                          }}
                          className="text-orange-600 font-semibold hover:underline"
                        >
                          Bill Now
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-stone-500">
                        No customers found. Customers are automatically added when orders include a mobile number.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedCustomer && (
            <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm">
                  Order History — {selectedCustomer.name} ({selectedCustomer.phone})
                </h4>
                <span className="text-stone-500">{selectedCustomer.address}</span>
              </div>
              {customerOrders.length === 0 ? (
                <p className="text-stone-500">No orders recorded yet for this customer.</p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {customerOrders.map((o) => (
                    <div key={o.id} className="py-2 flex justify-between gap-3">
                      <div>
                        <span className="font-mono-num font-semibold">{o.orderNumber}</span>
                        <span className="text-stone-500 ml-2">{o.itemsPreview}</span>
                      </div>
                      <span className="font-mono-num font-bold shrink-0">
                        {formatCurrency(o.grandTotal, sym)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
