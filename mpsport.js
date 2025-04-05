const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const adminService = require('./services/adminService');
const applicationService = require('./services/applicationService');
const groupService = require('./services/groupService');

const adminMessageIds = new Map();

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

async function checkBotPermissions() {
  try {
    const botInfo = await bot.telegram.getMe();
    logger.info(`Bot started as @${botInfo.username} (${botInfo.id})`);
    
    // Проверка прав бота в группе
    const botMember = await bot.telegram.getChatMember(GROUP_CHAT_ID, botInfo.id);
    
    if (!botMember || !['creator', 'administrator'].includes(botMember.status)) {
      logger.error('Bot is not an administrator in the group. Some features may not work correctly.');
      console.warn('⚠️ Бот не является администратором группы. Некоторые функции могут не работать корректно.');
    } else {
      logger.info('Bot has administrator rights in the group');
    }
  } catch (error) {
    logger.error(`Error checking bot permissions: ${error.message}`);
    console.error('❌ Ошибка при проверке прав бота:', error.message);
  }
}

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
    
    // Проверяем, является ли пользователь уже участником группы
    const isMember = await groupService.isUserMember(bot, userId, GROUP_CHAT_ID);
    
    if (isMember) {
      return ctx.reply(
        `Здравствуйте, ${firstName}! Вы уже являетесь участником нашей группы.`
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
      `Здравствуйте, ${firstName}! Этот бот поможет вам подать заявку на вступление в нашу группу Моно Спорт Питера.`,
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
    
    // Проверяем, является ли пользователь уже участником группы
    const isMember = await groupService.isUserMember(bot, userId, GROUP_CHAT_ID);
    
    if (isMember) {
      await ctx.answerCbQuery('Вы уже являетесь участником группы');
      return ctx.reply('Вы уже являетесь участником нашей группы.');
    }
    
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
    
    // Уведомление администраторов (передаем карту для хранения ID сообщений)
    await adminService.notifyAdmins(bot, applicant, adminMessageIds);
    
    // Подтверждение пользователю
    await ctx.answerCbQuery('Ваша заявка успешно отправлена!');
    await ctx.reply(
      '✅ Спасибо! Ваша заявка на вступление в группу успешно отправлена.\n\n' +
      'Администраторы рассмотрят её в ближайшее время. Вы получите уведомление о решении.'
    );
  } catch (error) {
    logger.error(`Error processing membership application: ${error.message}`);
    try {
      await ctx.answerCbQuery('Произошла ошибка при обработке заявки');
    } catch (cbError) {
      logger.error(`Failed to answer callback query: ${cbError.message}`);
    }
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
    
    // Проверяем, существует ли заявка и не обработана ли она уже
    const application = await applicationService.getApplicationByUserId(applicantId);
    
    if (!application) {
      await ctx.answerCbQuery('Заявка не найдена');
      await ctx.editMessageText(
        `${ctx.callbackQuery.message.text}\n\n` +
        `⚠️ <b>Ошибка:</b> Заявка не найдена или была удалена.`,
        { 
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        }
      );
      return;
    }
    
    if (application.status !== 'pending') {
      // Заявка уже обработана
      let statusText, statusEmoji;
      if (application.status === 'approved') {
        statusText = 'Одобрена';
        statusEmoji = '✅';
      } else {
        statusText = 'Отклонена';
        statusEmoji = '❌';
      }
      
      await ctx.answerCbQuery(`Заявка уже ${statusText.toLowerCase()}`);
      await ctx.editMessageText(
        `${ctx.callbackQuery.message.text}\n\n` +
        `⚠️ <b>Примечание:</b> Эта заявка уже была ${statusText.toLowerCase()}.\n` +
        `<b>Обработал:</b> ${application.processedBy ? `Администратор ID ${application.processedBy}` : 'Неизвестно'}\n` +
        `<b>Дата:</b> ${application.processedAt ? new Date(application.processedAt).toLocaleString() : 'Неизвестно'}`,
        { 
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        }
      );
      return;
    }
    
    if (action === 'approve') {
      // Сначала проверим, не вступил ли пользователь уже в группу
      const isMember = await groupService.isUserMember(bot, applicantId, GROUP_CHAT_ID);
      
      if (isMember) {
        // Обновление статуса заявки
        const updatedApplication = await applicationService.updateApplicationStatus(applicantId, 'approved', adminId);
        
        // Отправка уведомления пользователю
        await bot.telegram.sendMessage(
          applicantId,
          '✅ <b>Ваша заявка на вступление в группу одобрена!</b>\n\n' +
          'Наша система показывает, что вы уже являетесь участником группы. ' +
          'Вы можете продолжать пользоваться группой.',
          { parse_mode: 'HTML' }
        );
        
        // Уведомление администратора
        await ctx.answerCbQuery('Пользователь уже является участником группы');
        await ctx.editMessageText(
          `${ctx.callbackQuery.message.text}\n\n` +
          `<b>Решение:</b> Одобрено ✅\n` +
          `<b>Примечание:</b> Пользователь уже является участником группы\n` +
          `<b>Обработал:</b> ${ctx.from.first_name} ${ctx.from.last_name || ''}\n` +
          `<b>Дата:</b> ${new Date().toLocaleString()}`,
          { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
          }
        );
        
        // Уведомляем других администраторов об обновлении
        if (adminMessageIds.has(applicantId)) {
          await adminService.notifyAdminsAboutUpdate(
            bot, 
            updatedApplication, 
            ctx.from, 
            adminMessageIds.get(applicantId)
          );
        }
        
        return;
      }
      
      // Генерация временной ссылки для вступления
      try {
        const inviteLink = await bot.telegram.createChatInviteLink(GROUP_CHAT_ID, {
          expire_date: Math.floor(Date.now() / 1000) + 86400, // 24 часа
          member_limit: 1, // Одноразовое использование
          creates_join_request: false // Прямой вход по ссылке
        });
        
        // Обновление статуса заявки
        const updatedApplication = await applicationService.updateApplicationStatus(applicantId, 'approved', adminId, inviteLink.invite_link);
        
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
          `<b>Обработал:</b> ${ctx.from.first_name} ${ctx.from.last_name || ''}\n` +
          `<b>Дата:</b> ${new Date().toLocaleString()}`,
          { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
          }
        );
        
        // Уведомляем других администраторов об обновлении
        if (adminMessageIds.has(applicantId)) {
          await adminService.notifyAdminsAboutUpdate(
            bot, 
            updatedApplication, 
            ctx.from, 
            adminMessageIds.get(applicantId)
          );
        }
      } catch (error) {
        logger.error(`Error creating invite link: ${error.message}`);
        
        // Попытаемся вернуть более конкретную ошибку
        let errorMessage = 'Ошибка при создании ссылки-приглашения.';
        
        if (error.description) {
          if (error.description.includes('not enough rights')) {
            errorMessage += ' Бот не имеет необходимых прав администратора в группе.';
          } else if (error.description.includes('chat not found')) {
            errorMessage += ' Группа не найдена. Проверьте ID группы в настройках.';
          } else {
            errorMessage += ` Ошибка Telegram API: ${error.description}`;
          }
        }
        
        await ctx.answerCbQuery('Ошибка при создании ссылки-приглашения');
        await ctx.reply(errorMessage + ' Пожалуйста, проверьте настройки бота и группы.');
      }
    } else {
      // Отклонение заявки
      const updatedApplication = await applicationService.updateApplicationStatus(applicantId, 'rejected', adminId);
      
      // Проверим, что пользователь не в группе
      const isMember = await groupService.isUserMember(bot, applicantId, GROUP_CHAT_ID);
      
      // Уведомление пользователя
      if (isMember) {
        // Если пользователь уже в группе, отправим другое сообщение
        await bot.telegram.sendMessage(
          applicantId,
          '❌ Ваша заявка на вступление в группу была отклонена администратором. ' +
          'Однако наша система показывает, что вы уже являетесь участником группы.'
        );
      } else {
        await bot.telegram.sendMessage(
          applicantId,
          '❌ К сожалению, ваша заявка на вступление в группу была отклонена.'
        );
      }
      
      // Подтверждение администратору
      await ctx.answerCbQuery('Заявка отклонена. Пользователь уведомлен.');
      
      let additionalInfo = '';
      if (isMember) {
        additionalInfo = '\n<b>Примечание:</b> Пользователь уже является участником группы';
      }
      
      await ctx.editMessageText(
        `${ctx.callbackQuery.message.text}\n\n` +
        `<b>Решение:</b> Отклонено ❌${additionalInfo}\n` +
        `<b>Обработал:</b> ${ctx.from.first_name} ${ctx.from.last_name || ''}\n` +
        `<b>Дата:</b> ${new Date().toLocaleString()}`,
        { 
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        }
      );
      
      // Уведомляем других администраторов об обновлении
      if (adminMessageIds.has(applicantId)) {
        await adminService.notifyAdminsAboutUpdate(
          bot, 
          updatedApplication, 
          ctx.from, 
          adminMessageIds.get(applicantId)
        );
      }
    }
  } catch (error) {
    logger.error(`Error processing admin decision: ${error.message}`);
    try {
      await ctx.answerCbQuery('Произошла ошибка при обработке решения');
    } catch (cbError) {
      logger.error(`Failed to answer callback query: ${cbError.message}`);
    }
    
    try {
      // Попытка сохранить текущий текст сообщения
      const currentText = ctx.callbackQuery && ctx.callbackQuery.message ? 
                          ctx.callbackQuery.message.text : 
                          'Информация о заявке';
                          
      await ctx.editMessageText(
        `${currentText}\n\n` +
        `⚠️ <b>Ошибка:</b> Произошла ошибка при обработке решения.\n` +
        `<b>Подробности:</b> ${error.message}\n\n` +
        `Пожалуйста, попробуйте снова или обратитесь к разработчику бота.`,
        { 
          parse_mode: 'HTML',
          reply_markup: { 
            inline_keyboard: [
              [{ text: 'Повторить попытку', callback_data: ctx.callbackQuery.data }]
            ] 
          }
        }
      );
    } catch (editError) {
      logger.error(`Failed to edit message with error details: ${editError.message}`);
      await ctx.reply('Произошла ошибка при обработке вашего решения. Пожалуйста, попробуйте снова позже.');
    }
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
  .then(async () => {
    logger.info('Bot started successfully');
    console.log('✅ Бот успешно запущен');
    
    // Проверка прав бота
    await checkBotPermissions();
  })
  .catch(err => {
    logger.error(`Error starting bot: ${err.message}`);
    console.error('❌ Ошибка при запуске бота:', err.message);
    process.exit(1);
  });

// Включение graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));