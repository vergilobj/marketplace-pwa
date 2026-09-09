import { Injectable } from '@nestjs/common';
import { DealService } from './deal.service';
import { AutopilotService } from './autopilot.service';
import { BazarMessage } from '@prisma/client';

export type IntentAction =
  | { intent: 'create_deal'; payload: { productId?: string; sellerId?: string } }
  | { intent: 'relay_message'; payload: { dealId: string; text: string } }
  | { intent: 'ask_question'; payload: { dealId: string; question: string } }
  | { intent: 'view_order_status'; payload: { orderId?: string } }
  | { intent: 'accept_deal'; payload: { dealId: string } }
  | { intent: 'cancel_deal'; payload: { dealId: string; reason?: string } }
  | { intent: 'reject_deal'; payload: { dealId: string; reason?: string } }
  | { intent: 'ask_availability'; payload: { productId: string } }
  | { intent: 'autopilot_request'; payload: { goal: string; budget?: number } }
  | { intent: 'autopilot_confirm'; payload: { accept: boolean; productId?: string } }
  | { intent: 'autopilot_refine'; payload: { feedback: string } }
  | { intent: 'counter_offer'; payload: { dealId: string; amount: number } }
  | { intent: 'accept_offer'; payload: { dealId: string; offerId: string } }
  | { intent: 'reject_offer'; payload: { dealId: string; offerId: string } }
  | { intent: 'none'; payload: Record<string, never> };

/**
 * Исполняет структурированное действие (meta.action) детерминированно.
 * SPEC §5.3. LLM только распознаёт intent + payload; здесь — выполнение.
 */
@Injectable()
export class IntentDispatcher {
  constructor(
    private readonly deals: DealService,
    private readonly autopilot: AutopilotService,
  ) {}

  async dispatch(userId: string, action: IntentAction, _msg?: BazarMessage) {
    if (!action?.intent || action.intent === 'none') return null;

    switch (action.intent) {
      case 'create_deal':
        return this.deals.createFromChat(userId, action.payload, _msg);

      case 'relay_message':
        return this.deals.relay(userId, {
          dealId: action.payload.dealId,
          text: action.payload.text,
        });

      case 'ask_question':
        // ретрансляция вопроса — то же, что relay
        return this.deals.relay(userId, {
          dealId: action.payload.dealId,
          text: action.payload.question,
        });

      case 'accept_deal':
        return this.deals.accept(userId, action.payload.dealId);

      case 'cancel_deal':
      case 'reject_deal':
        return this.deals.lose(userId, action.payload.dealId, action.payload.reason);

      case 'view_order_status':
        return this.deals.orderStatus(userId, action.payload.orderId);

      case 'ask_availability':
        return this.deals.relayAvailability(userId, action.payload.productId);

      case 'autopilot_request':
        return this.autopilot.start(userId, action.payload.goal, action.payload.budget);

      case 'autopilot_confirm':
        return this.autopilot.resume(userId, { type: 'confirm', ...action.payload });

      case 'autopilot_refine':
        return this.autopilot.resume(userId, { type: 'refine', feedback: action.payload.feedback });

      case 'counter_offer':
        return this.deals.counterOffer(userId, {
          dealId: action.payload.dealId,
          amount: action.payload.amount,
        });

      case 'accept_offer':
        return this.deals.acceptOffer(userId, {
          dealId: action.payload.dealId,
          offerId: action.payload.offerId,
        });

      case 'reject_offer':
        return this.deals.rejectOffer(userId, {
          dealId: action.payload.dealId,
          offerId: action.payload.offerId,
        });

      default:
        return null;
    }
  }
}