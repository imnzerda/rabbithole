import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Prestataire de paiement (section 14). Le reste du code ne dépend que de cette interface : on pourra
 * brancher un prestataire classique ou spécialisé (CCBill, Segpay, Verotel) sans rien changer d'autre.
 * Un achat n'est jamais crédité au retour du navigateur : uniquement par un webhook vérifié.
 */

export interface CheckoutRequest {
  transactionId: string;
  userId: string;
  productId: string;
  label: string;
  /** Montant en unité mineure de la devise (centimes ; le yen n'en a pas). */
  amount: number;
  currency: string;
}

export interface Checkout {
  /** Identifiant de la session de paiement chez le prestataire. */
  sessionId: string;
  /** Page de paiement où envoyer le joueur. */
  url: string;
}

/** Événement reçu par webhook, une fois la signature vérifiée. */
export type PaymentEvent =
  | { id: string; type: 'payment_succeeded'; sessionId: string; providerTransactionId: string; amount: number; currency: string }
  | { id: string; type: 'refunded' | 'chargeback'; providerTransactionId: string };

export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<Checkout>;
  /** Vérifie la signature d'un webhook et le décode ; `null` s'il n'est pas authentique. */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): PaymentEvent | null;
  /** Demande un remboursement ; le prestataire le confirme ensuite par webhook. */
  refund(providerTransactionId: string): Promise<void>;
}

const SIGNATURE_HEADER = 'x-sandbox-signature';

/**
 * Prestataire factice (développement et tests, interdit en production) : sa « page de paiement » est
 * une page du site, et il confirme les paiements par des webhooks signés (HMAC-SHA256), exactement
 * comme un vrai prestataire. `deliver` envoie un webhook au serveur.
 */
export class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox';

  constructor(
    private readonly secret: string,
    private readonly deliver: (rawBody: string, headers: Record<string, string>) => Promise<void>,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<Checkout> {
    const sessionId = `sbx_${randomBytes(12).toString('hex')}`;
    return { sessionId, url: `/shop/sandbox?session=${sessionId}&tx=${request.transactionId}` };
  }

  sign(rawBody: string): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): PaymentEvent | null {
    const given = headers[SIGNATURE_HEADER];
    if (typeof given !== 'string' || !/^[0-9a-f]{64}$/.test(given)) return null;
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(given, 'hex'))) return null;
    try {
      return JSON.parse(rawBody) as PaymentEvent;
    } catch {
      return null;
    }
  }

  /** Le joueur a payé sur la page factice : le « prestataire » envoie le webhook de confirmation. */
  async pay(sessionId: string, amount: number, currency: string): Promise<void> {
    await this.emit({ id: `evt_${randomBytes(8).toString('hex')}`, type: 'payment_succeeded', sessionId, providerTransactionId: `sbx_tx_${randomBytes(8).toString('hex')}`, amount, currency });
  }

  async refund(providerTransactionId: string): Promise<void> {
    await this.emit({ id: `evt_${randomBytes(8).toString('hex')}`, type: 'refunded', providerTransactionId });
  }

  async emit(event: PaymentEvent): Promise<void> {
    const rawBody = JSON.stringify(event);
    await this.deliver(rawBody, { 'content-type': 'application/json', [SIGNATURE_HEADER]: this.sign(rawBody) });
  }
}
