import Stripe from 'stripe';
export function stripe(){return new Stripe(process.env.STRIPE_SECRET_KEY!);}
