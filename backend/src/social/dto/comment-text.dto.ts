import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * GAPS-A: POST /social/:postId/comments и PATCH /social/comments/:commentId.
 *
 * Было `@Body('text') text: string` — сырое значение. `{text: 123}` доходил до
 * модерации и Prisma. Текст обязателен, ограничен по длине.
 */
export class CommentTextDto {
  @IsString()
  @IsNotEmpty({ message: 'text обязателен' })
  @MaxLength(2000)
  text: string;
}

/**
 * GAPS-A: POST /invites — опциональный кастомный код.
 * Было `@Body('code') code?: string`; строка нужна для колонки `Invite.code`.
 */
export class CreateInviteDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}