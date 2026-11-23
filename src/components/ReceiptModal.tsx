import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Printer, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { getLocalOfflineOrder } from '../lib/offlineDb';
import { formatCurrency, formatTimestamp } from '../lib/permissions';
import { isLikelyNetworkError, isOfflineOrderId } from '../lib/syncEngine';
import { Order, OrderItem, PrinterWidth, RestaurantSettings } from '../types/pos';

interface ReceiptModalProps {
  order: Order;
  settings: RestaurantSettings;
  mode: 'RECEIPT' | 'KOT';
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  order,
  settings,
  mode,
  onClose,
}) => {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [paperSize, setPaperSize] = useState<PrinterWidth>(settings.printerWidth || '80mm');

  useEffect(() => {
    let active = true;
    async function loadItems() {
      setLoading(true);
      try {
        if (isOfflineOrderId(order.id)) {
          const localRec = await getLocalOfflineOrder(order.id);
          if (active) {
            setItems(localRec ? localRec.items : []);
            setLoading(false);
          }
          return;
        }
        const snap = await getDocs(
          query(collection(db, 'orders', order.id, 'items'), where('orderId', '==', order.id))
        );
        if (active) {
          setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrderItem)));
          setLoading(false);
        }
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          if (active) {
            setItems([]);
            setLoading(false);
          }
          return;
        }
        handleFirestoreError(err, OperationType.LIST, `orders/${order.id}/items`);
      }
    }
    loadItems();
    return () => {
      active = false;
    };
  }, [order.id]);

  const widthClass =
    paperSize === '58mm'
      ? 'max-w-[240px] print-area-58mm'
      : paperSize === '80mm'
        ? 'max-w-[320px] print-area-80mm'
        : 'max-w-[680px] print-area-A4';

  const sym = settings.currencySymbol || '₹';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {mode === 'KOT' ? 'Kitchen Order Ticket (KOT)' : 'Customer Bill / Tax Invoice'}
            </h3>
            <span className="text-xs font-mono-num text-stone-500 dark:text-stone-400">
              {order.orderNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'RECEIPT' && (
              <div className="flex items-center bg-stone-100 dark:bg-stone-800 rounded-lg p-0.5 text-xs">
                {(['58mm', '80mm', 'A4'] as PrinterWidth[]).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setPaperSize(w)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      paperSize === w
                        ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                        : 'text-stone-600 dark:text-stone-400'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              Print {mode === 'KOT' ? 'KOT' : paperSize}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close print preview"
              className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto bg-stone-100 dark:bg-stone-950 flex justify-center">
          <div
            className={`w-full bg-white text-stone-900 p-5 border border-stone-300 shadow-sm font-mono-num text-xs leading-relaxed ${widthClass}`}
          >
            {mode === 'KOT' ? (
              <div className="space-y-3">
                <div className="text-center border-b border-dashed border-stone-400 pb-2">
                  <p className="text-sm font-bold uppercase tracking-wider">KITCHEN ORDER TICKET</p>
                  <p className="font-semibold">{settings.restaurantName}</p>
                </div>
                <div className="flex justify-between text-[11px] border-b border-dashed border-stone-400 pb-2">
                  <div>
                    <p className="font-bold text-sm">#{order.orderNumber}</p>
                    <p>{order.orderType.replace('_', ' ')}</p>
                    {order.tableName && <p className="font-bold">Table: {order.tableName}</p>}
                  </div>
                  <div className="text-right">
                    <p>{formatTimestamp(order.createdAt)}</p>
                    <p>Cashier: {order.createdByName}</p>
                  </div>
                </div>

                {loading ? (
                  <p className="text-center py-4">Loading items...</p>
                ) : (
                  <div className="space-y-2 border-b border-dashed border-stone-400 pb-3">
                    {items.map((item) => (
                      <div key={item.id} className="space-y-0.5">
                        <div className="flex justify-between font-bold text-xs">
                          <span>
                            {item.quantity} x {item.productName}
                            {item.variantName ? ` (${item.variantName})` : ''}
                          </span>
                        </div>
                        {item.addonsSummary && (
                          <p className="pl-3 text-[11px] text-stone-700">
                            + {item.addonsSummary}
                          </p>
                        )}
                        {item.specialInstructions && (
                          <p className="pl-3 text-[11px] font-bold underline">
                            NOTE: {item.specialInstructions}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {order.notes && (
                  <p className="text-[11px] font-bold">ORDER NOTE: {order.notes}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-center border-b border-dashed border-stone-400 pb-3 space-y-1">
                  {settings.logoUrl && (
                    <img
                      src={settings.logoUrl}
                      alt={settings.restaurantName}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full object-cover mx-auto mb-1 border border-stone-300"
                    />
                  )}
                  <p className="text-base font-bold uppercase tracking-wide">
                    {settings.restaurantName}
                  </p>
                  <p className="text-[11px] text-stone-700">{settings.address}</p>
                  <p className="text-[11px] text-stone-700">Tel: {settings.phone}</p>
                  {settings.gstin && (
                    <p className="text-[11px] font-semibold">GSTIN: {settings.gstin}</p>
                  )}
                </div>

                <div className="flex justify-between text-[11px] border-b border-dashed border-stone-400 pb-2">
                  <div className="space-y-0.5">
                    <p className="font-bold">Bill: {order.orderNumber}</p>
                    <p>Type: {order.orderType.replace('_', ' ')}</p>
                    {order.tableName && <p>Table: {order.tableName}</p>}
                  </div>
                  <div className="text-right space-y-0.5">
                    <p>{formatTimestamp(order.createdAt)}</p>
                    <p>Staff: {order.createdByName}</p>
                    <p>Status: {order.paymentStatus}</p>
                  </div>
                </div>

                {(order.customerName || order.customerPhone) && (
                  <div className="text-[11px] border-b border-dashed border-stone-400 pb-2">
                    <p>
                      Customer: {order.customerName}
                      {order.customerPhone ? ` (${order.customerPhone})` : ''}
                    </p>
                    {order.deliveryAddress && <p>Addr: {order.deliveryAddress}</p>}
                  </div>
                )}

                {loading ? (
                  <p className="text-center py-4">Loading line items...</p>
                ) : (
                  <table className="w-full text-[11px] border-b border-dashed border-stone-400 pb-2">
                    <thead>
                      <tr className="border-b border-stone-300 text-left">
                        <th className="py-1">Item</th>
                        <th className="py-1 text-center">Qty</th>
                        <th className="py-1 text-right">Amt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="align-top">
                          <td className="py-1 pr-2">
                            <p className="font-semibold">
                              {item.productName}
                              {item.variantName ? ` (${item.variantName})` : ''}
                            </p>
                            {item.addonsSummary && (
                              <p className="text-[10px] text-stone-600">+ {item.addonsSummary}</p>
                            )}
                            {item.itemDiscountAmount > 0 && (
                              <p className="text-[10px] text-stone-600">
                                Disc: -{formatCurrency(item.itemDiscountAmount, sym)}
                              </p>
                            )}
                          </td>
                          <td className="py-1 text-center">{item.quantity}</td>
                          <td className="py-1 text-right font-semibold">
                            {formatCurrency(item.lineTotal, sym)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="space-y-1 text-[11px] border-b border-dashed border-stone-400 pb-2">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatCurrency(order.subtotal, sym)}</span>
                  </div>
                  {order.itemDiscountTotal > 0 && (
                    <div className="flex justify-between">
                      <span>Item Discounts</span>
                      <span>-{formatCurrency(order.itemDiscountTotal, sym)}</span>
                    </div>
                  )}
                  {order.cartDiscountAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Bill Discount ({order.cartDiscountPercent}%)</span>
                      <span>-{formatCurrency(order.cartDiscountAmount, sym)}</span>
                    </div>
                  )}
                  {order.taxAmount > 0 && (
                    <div className="flex justify-between">
                      <span>GST / Tax ({order.taxRate}%)</span>
                      <span>{formatCurrency(order.taxAmount, sym)}</span>
                    </div>
                  )}
                  {order.serviceChargeAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Service Charge</span>
                      <span>{formatCurrency(order.serviceChargeAmount, sym)}</span>
                    </div>
                  )}
                  {order.deliveryCharge > 0 && (
                    <div className="flex justify-between">
                      <span>Delivery Charge</span>
                      <span>{formatCurrency(order.deliveryCharge, sym)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold pt-1 border-t border-stone-300">
                    <span>GRAND TOTAL</span>
                    <span>{formatCurrency(order.grandTotal, sym)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Paid ({order.paymentMethodsSummary})</span>
                    <span>{formatCurrency(order.paidAmount, sym)}</span>
                  </div>
                  {order.grandTotal - order.paidAmount > 0.01 && (
                    <div className="flex justify-between font-bold">
                      <span>Balance Due</span>
                      <span>{formatCurrency(order.grandTotal - order.paidAmount, sym)}</span>
                    </div>
                  )}
                </div>

                <div className="text-center text-[11px] pt-1 space-y-1">
                  <p className="font-semibold">{settings.receiptFooter}</p>
                  <p className="text-[10px] text-stone-500">
                    Hours: {settings.openingHours}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
