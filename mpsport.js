const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const adminService = require('./services/adminService');
const applicationService = require('./services/applicationService');

// Загрузка переменных окружения
dotenv.config();

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(() => logger.info('Connected to MongoDB'))
.catch(err => {
  logger.error(`MongoDB connection error: ${err.message}`);
  process.exit(1);
});

// Инициализация бота
const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

// Обработчик команды /start
bot.start(async (ctx) => {
  try {
    // Проверяем, что команда отправлена в личном чате с ботом
    if (ctx.chat.type !== 'private') return;
    
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || '';
    
    // Проверка, является ли пользователь администратором
    if (adminService.isAdmin(userId)) {
      return ctx.reply(
        `Здравствуйте, ${firstName}! Вы являетесь администратором этого бота. ` +
        `Вам будут приходить уведомления о новых заявках на вступление в группу.`
      );
    }
    
    // Проверка наличия активной заявки
    const hasPending = await applicationService.hasPendingApplication(userId);
    
    if (hasPending) {
      return ctx.reply(
        `Здравствуйте, ${firstName}! У вас уже есть активная заявка на вступление в группу. ` +
        `Пожалуйста, дождитесь её рассмотрения администраторами.`
      );
    }
    
    // Отправка приветственного сообщения и кнопки подачи заявки
    await ctx.reply(
      `Здравствуйте, ${firstName}! Этот бот поможет вам подать заявку на вступление в нашу закрытую группу.`,
      Markup.inlineKeyboard([
        Markup.button.callback('Подать заявку на вступление', 'apply_for_membership')
      ])
    );
  } catch (error) {
    logger.error(`Error in /start command: ${error.message}`);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
});

// Обработчик нажатия кнопки подачи заявки
bot.action('apply_for_membership', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || 'Нет имени';
    const lastName = ctx.from.last_name || '';
    
    // Проверка наличия активной заявки
    const hasPending = await applicationService.hasPendingApplication(userId);
    
    if (hasPending) {
      await ctx.answerCbQuery('У вас уже есть активная заявка на рассмотрении');
      return ctx.reply('У вас уже есть активная заявка на вступление в группу. Пожалуйста, дождитесь её рассмотрения администраторами.');
    }
    
    // Сохранение заявки
    const applicant = {
      userId,
      username,
      firstName,
      lastName
    };
    
    await applicationService.saveApplication(applicant);
    
    // Уведомление администраторов
    await adminService.notifyAdmins(bot, applicant);
    
    // Подтверждение пользователю
    await ctx.answerCbQuery('Ваша заявка успешно отправлена!');
    await ctx.reply(
      '✅ Спасибо! Ваша заявка на вступление в группу успешно отправлена.\n\n' +
      'Администраторы рассмотрят её в ближайшее время. Вы получите уведомление о решении.'
    );
  } catch (error) {
    logger.error(`Error processing membership application: ${error.message}`);
    await ctx.answerCbQuery('Произошла ошибка при обработке заявки');
    await ctx.reply('Произошла ошибка при обработке вашей заявки. Пожалуйста, попробуйте позже или свяжитесь с администратором.');
  }
});

// Обработчик решения администратора по заявке
bot.action(/^(approve|reject)_(\d+)$/, async (ctx) => {
  try {
    const adminId = ctx.from.id;
    
    // Проверка, является ли пользователь администратором
    if (!adminService.isAdmin(adminId)) {
      return ctx.answerCbQuery('У вас нет прав для выполнения этого действия');
    }
    
    const action = ctx.match[1];
    const applicantId = parseInt(ctx.match[2]);
    
    if (action === 'approve') {
      // Генерация временной ссылки для вступления
      try {
        const inviteLink = await bot.telegram.createChatInviteLink(GROUP_CHAT_ID, {
          expire_date: Math.floor(Date.now() / 1000) + 86400, // 24 часа
          member_limit: 1, // Одноразовое использование
          creates_join_request: false // Прямой вход по ссылке
        });
        
        // Обновление статуса заявки
        await applicationService.updateApplicationStatus(applicantId, 'approved', adminId, inviteLink.invite_link);
        
        // Отправка ссылки пользователю
        await bot.telegram.sendMessage(
          applicantId,
          '✅ <b>Ваша заявка на вступление в группу одобрена!</b>\n\n' +
          'Используйте ссылку ниже для входа в группу:\n' +
          `${inviteLink.invite_link}\n\n` +
          '<i>Обратите внимание: ссылка действительна в течение 24 часов и может быть использована только один раз.</i>',
          { parse_mode: 'HTML' }
        );
        
        // Подтверждение администратору
        await ctx.answerCbQuery('Заявка одобрена. Пользователь получил ссылку для вступления.');
        await ctx.editMessageText(
          `${ctx.callbackQuery.message.text}\n\n` +
          `<b>Решение:</b> Одобрено ✅\n` +
          `<b>Обработал:</b> ${ctx.from.first_name} ${ctx.from.last_name || ''}`,
          { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
          }
        );
      } catch (error) {
        logger.error(`Error creating invite link: ${error.message}`);
        await ctx.answerCbQuery('Ошибка при создании ссылки-приглашения');
        await ctx.reply('Произошла ошибка при создании ссылки-приглашения. Убедитесь, что бот имеет права администратора в группе.');
      }
    } else {
      // Отклонение заявки
      await applicationService.updateApplicationStatus(applicantId, 'rejected', adminId);
      
      // Уведомление пользователя
      await bot.telegram.sendMessage(
        applicantId,
        '❌ К сожалению, ваша заявка на вступление в группу была отклонена.'
      );
      
      // Подтверждение администратору
      await ctx.answerCbQuery('Заявка отклонена. Пользователь уведомлен.');
      await ctx.editMessageText(
        `${ctx.callbackQuery.message.text}\n\n` +
        `<b>Решение:</b> Отклонено ❌\n` +
        `<b>Обработал:</b> ${ctx.from.first_name} ${ctx.from.last_name || ''}`,
        { 
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        }
      );
    }
  } catch (error) {
    logger.error(`Error processing admin decision: ${error.message}`);
    await ctx.answerCbQuery('Произошла ошибка при обработке решения');
    await ctx.reply('Произошла ошибка при обработке вашего решения. Пожалуйста, попробуйте снова позже.');
  }
});

// Команда для добавления ссылки на бота в описание группы
bot.command('setbotlink', async (ctx) => {
  if (ctx.chat.type === 'private' && adminService.isAdmin(ctx.from.id)) {
    try {
      const botInfo = await bot.telegram.getMe();
      const botLink = `https://t.me/${botInfo.username}`;
      
      await ctx.reply(
        `Бот настроен для обработки заявок на вступление в группу.\n\n` +
        `Для того чтобы пользователи могли подавать заявки, добавьте эту ссылку в описание группы:\n` +
        `${botLink}\n\n` +
        `Текст для описания группы может быть следующим:\n` +
        `"Для вступления в группу, пожалуйста, перейдите по ссылке и подайте заявку: ${botLink}"`
      );
    } catch (error) {
      logger.error(`Error in /setbotlink command: ${error.message}`);
      await ctx.reply('Произошла ошибка при получении информации о боте.');
    }
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  logger.error(`Unexpected error: ${err.message}`);
  ctx.reply('Произошла непредвиденная ошибка. Пожалуйста, попробуйте позже.').catch(e => {});
});

// Запуск бота
bot.launch()
  .then(() => {
    logger.info('Bot started successfully');
    console.log('Bot is running...');
  })
  .catch(err => {
    logger.error(`Error starting bot: ${err.message}`);
    process.exit(1);
  });

// Включение graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));