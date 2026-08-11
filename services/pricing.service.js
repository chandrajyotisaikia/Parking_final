// services/pricing.service.js — the ONE place pricing rules live. Edit prices here.
const PRICING = {
  CAR: { SUBSCRIBER: 0, NON_SUBSCRIBER: 80 },
  BIKE: { SUBSCRIBER: 0, NON_SUBSCRIBER: 40 },
};

// Monthly subscription rates — used to calculate what a subscriber owes for their chosen period
const SUBSCRIPTION_MONTHLY_RATE = { CAR: 800, BIKE: 400 };

function calculateCharge(vehicleType, isSubscriber) {
  const type = vehicleType.toUpperCase();
  if (!PRICING[type]) throw new Error('Invalid vehicle type: ' + vehicleType);
  return isSubscriber ? PRICING[type].SUBSCRIBER : PRICING[type].NON_SUBSCRIBER;
}

// Prorates the monthly rate by the number of days between start and end (inclusive)
function calculateSubscriptionAmount(vehicleType, startDate, endDate) {
  const type = vehicleType.toUpperCase();
  if (!SUBSCRIPTION_MONTHLY_RATE[type]) throw new Error('Invalid vehicle type: ' + vehicleType);
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
  const dailyRate = SUBSCRIPTION_MONTHLY_RATE[type] / 30;
  return Math.round(dailyRate * days);
}

module.exports = { calculateCharge, calculateSubscriptionAmount, SUBSCRIPTION_MONTHLY_RATE };
