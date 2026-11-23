import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { usePos } from '../context/PosContext';
import { saveRestaurantSettings } from '../lib/posService';
import { PrinterWidth } from '../types/pos';

export const SettingsView: React.FC = () => {
  const { settings, firebaseUser, activeRole, activeStaffUids, notify } = usePos();

  const [restaurantName, setRestaurantName] = useState(settings.restaurantName);
  const [address, setAddress] = useState(settings.address);
  const [phone, setPhone] = useState(settings.phone);
  const [gstin, setGstin] = useState(settings.gstin);
  const [currency, setCurrency] = useState(settings.currency);
  const [currencySymbol, setCurrencySymbol] = useState(settings.currencySymbol);
  const [taxRate, setTaxRate] = useState(settings.taxRate);
  const [serviceChargeRate, setServiceChargeRate] = useState(settings.serviceChargeRate);
  const [defaultDeliveryCharge, setDefaultDeliveryCharge] = useState(settings.defaultDeliveryCharge);
  const [receiptFooter, setReceiptFooter] = useState(settings.receiptFooter);
  const [printerWidth, setPrinterWidth] = useState<PrinterWidth>(settings.printerWidth);
  const [orderPrefix, setOrderPrefix] = useState(settings.orderPrefix);
  const [nextOrderNumber, setNextOrderNumber] = useState(settings.nextOrderNumber);
  const [openingHours, setOpeningHours] = useState(settings.openingHours);
  const [autoDeductInventory, setAutoDeductInventory] = useState(settings.autoDeductInventory);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRestaurantName(settings.restaurantName);
    setAddress(settings.address);
    setPhone(settings.phone);
    setGstin(settings.gstin);
    setCurrency(settings.currency);
    setCurrencySymbol(settings.currencySymbol);
    setTaxRate(settings.taxRate);
    setServiceChargeRate(settings.serviceChargeRate);
    setDefaultDeliveryCharge(settings.defaultDeliveryCharge);
    setReceiptFooter(settings.receiptFooter);
    setPrinterWidth(settings.printerWidth);
    setOrderPrefix(settings.orderPrefix);
    setNextOrderNumber(settings.nextOrderNumber);
    setOpeningHours(settings.openingHours);
    setAutoDeductInventory(settings.autoDeductInventory);
    setLogoUrl(settings.logoUrl);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setSaving(true);
    try {
      await saveRestaurantSettings({
        settings: {
          restaurantName: restaurantName.trim() || 'Shawarma Cafe',
          address: address.trim(),
          phone: phone.trim(),
          gstin: gstin.trim(),
          currency: currency.trim() || 'INR',
          currencySymbol: currencySymbol.trim() || '₹',
          taxRate: Number(taxRate) || 0,
          serviceChargeRate: Number(serviceChargeRate) || 0,
          defaultDeliveryCharge: Number(defaultDeliveryCharge) || 0,
          receiptFooter: receiptFooter.trim(),
          printerWidth,
          orderPrefix: orderPrefix.trim() || 'SC',
          nextOrderNumber: Math.max(1, Number(nextOrderNumber) || 1001),
          openingHours: openingHours.trim(),
          autoDeductInventory,
          logoUrl: logoUrl.trim(),
        },
        actorUid: firebaseUser.uid,
        actorEmail: firebaseUser.email || '',
        actorRole: activeRole,
        staffUids: activeStaffUids,
      });
      notify('Restaurant settings saved.', 'success');
    } catch (err: any) {
      notify(err?.message || 'Unable to save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100">
          Restaurant Settings
        </h2>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Configure store branding, GST/tax, receipt printer defaults, order numbering, and inventory rules
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-6 space-y-5 text-xs"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium mb-1">Restaurant Name *</label>
            <input
              type="text"
              required
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Phone Number</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium mb-1">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">GSTIN / Tax ID</label>
            <input
              type="text"
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
              className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block font-medium mb-1">Currency Code</label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Symbol</label>
            <input
              type="text"
              value={currencySymbol}
              onChange={(e) => setCurrencySymbol(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Tax / GST %</label>
            <input
              type="number"
              min={0}
              max={50}
              step="0.1"
              value={taxRate}
              onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
              className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Service Charge %</label>
            <input
              type="number"
              min={0}
              max={50}
              step="0.1"
              value={serviceChargeRate}
              onChange={(e) => setServiceChargeRate(Number(e.target.value) || 0)}
              className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block font-medium mb-1">Delivery Charge</label>
            <input
              type="number"
              min={0}
              value={defaultDeliveryCharge}
              onChange={(e) => setDefaultDeliveryCharge(Number(e.target.value) || 0)}
              className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Thermal Printer</label>
            <select
              value={printerWidth}
              onChange={(e) => setPrinterWidth(e.target.value as PrinterWidth)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            >
              <option value="58mm">58mm Thermal</option>
              <option value="80mm">80mm Thermal</option>
              <option value="A4">A4 Invoice</option>
            </select>
          </div>
          <div>
            <label className="block font-medium mb-1">Order Prefix</label>
            <input
              type="text"
              value={orderPrefix}
              onChange={(e) => setOrderPrefix(e.target.value)}
              className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Next Order #</label>
            <input
              type="number"
              min={1}
              value={nextOrderNumber}
              onChange={(e) => setNextOrderNumber(Number(e.target.value) || 1)}
              className="w-full min-h-[38px] px-3 font-mono-num rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium mb-1">Opening Hours</label>
            <input
              type="text"
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Logo URL</label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
            />
          </div>
        </div>

        <div>
          <label className="block font-medium mb-1">Receipt Footer Message</label>
          <input
            type="text"
            value={receiptFooter}
            onChange={(e) => setReceiptFooter(e.target.value)}
            className="w-full min-h-[38px] px-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800"
          />
        </div>

        <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={autoDeductInventory}
            onChange={(e) => setAutoDeductInventory(e.target.checked)}
          />
          Automatically deduct ingredient stock from configured recipes when orders are paid
        </label>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="min-h-[42px] inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
};
