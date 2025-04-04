const logger = require('../utils/logger');

/**
 * Проверяет, является ли пользователь администратором
 * @param {number} userId - Telegram ID пользователя
 * @returns {boolean} - true если пользователь является администратором
 */
function isAdmin(userId) {
  const adminIds = process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()));
  return adminIds.includes(userId);
}

/**
 * Получает список администраторов
 * @returns {Array<number>} - Массив ID администраторов
 */
function getAdminIds() {
  return process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()));
}

/**
 * Уведомляет всех администраторов о новой заявке
 * @param {Object} bot - Экземпляр Telegraf бота
 * @param {Object} applicant - Объект с данными заявителя
 * @param {Map<number, Map<number, number>>} adminMessageIds - Карта для хранения ID сообщений
 * @returns {Promise<void>}
 */
async function notifyAdmins(bot, applicant, adminMessageIds) {
  const adminIds = getAdminIds();
  
  // Создаем новую карту для этой заявки, если ее еще нет
  if (!adminMessageIds.has(applicant.userId)) {
    adminMessageIds.set(applicant.userId, new Map());
  }
  
  const applicantMessageMap = adminMessageIds.get(applicant.userId);
  
  for (const adminId of adminIds) {
    try {
      const message = await bot.telegram.sendMessage(
        adminId,
        `🔔 <b>Новая заявка на вступление в группу</b>\n\n` +
        `<b>Имя:</b> ${applicant.firstName} ${applicant.lastName}\n` +
        `<b>Username:</b> ${applicant.username ? '@' + applicant.username : 'Не указан'}\n` +
        `<b>ID:</b> ${applicant.userId}\n\n` +
        `Пожалуйста, примите решение по этой заявке:`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Принять', callback_data: `approve_${applicant.userId}` },
                { text: '❌ Отклонить', callback_data: `reject_${applicant.userId}` }
              ]
            ]
          }
        }
      );
      
      // Сохраняем ID сообщения для этого админа
      applicantMessageMap.set(adminId, message.message_id);
      
      logger.info(`Notification sent to admin ${adminId} about application from user ${applicant.userId}`);
    } catch (error) {
      logger.error(`Failed to notify admin ${adminId}: ${error.message}`);
    }
  }
}

/**
 * Уведомляет всех администраторов об обновлении статуса заявки
 * @param {Object} bot - Экземпляр Telegraf бота
 * @param {Object} application - Обновленная заявка
 * @param {Object} adminWhoProcessed - Информация об администраторе, обработавшем заявку
 * @param {Map<number, number>} adminMessagesMap - Карта сообщений админам (adminId -> messageId)
 * @returns {Promise<void>}
 */
async function notifyAdminsAboutUpdate(bot, application, adminWhoProcessed, adminMessagesMap) {
  const adminIds = getAdminIds();
  
  for (const adminId of adminIds) {
    // Пропускаем админа, который обработал заявку (он уже получил обновление)
    if (adminId === adminWhoProcessed.id) continue;
    
    // Получаем ID сообщения для этого админа
    const messageId = adminMessagesMap.get(adminId);
    if (!messageId) {
      logger.warn(`No message ID found for admin ${adminId} for application ${application.userId}`);
      continue;
    }
    
    try {
      // Создаем текст сообщения о решении
      let statusText, statusEmoji;
      if (application.status === 'approved') {
        statusText = 'Одобрено';
        statusEmoji = '✅';
      } else {
        statusText = 'Отклонено';
        statusEmoji = '❌';
      }
      
      // Обновляем сообщение у админа
      await bot.telegram.editMessageText(
        adminId, 
        messageId,
        null, 
        `🔔 <b>Заявка на вступление в группу</b>\n\n` +
        `<b>Имя:</b> ${application.firstName} ${application.lastName}\n` +
        `<b>Username:</b> ${application.username ? '@' + application.username : 'Не указан'}\n` +
        `<b>ID:</b> ${application.userId}\n\n` +
        `<b>Решение:</b> ${statusText} ${statusEmoji}\n` +
        `<b>Обработал:</b> ${adminWhoProcessed.first_name} ${adminWhoProcessed.last_name || ''}\n` +
        `<b>Дата:</b> ${new Date(application.processedAt).toLocaleString()}`,
        { 
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        }
      );
      
      logger.info(`Notification updated for admin ${adminId} about application status change for user ${application.userId}`);
    } catch (error) {
      logger.error(`Failed to update notification for admin ${adminId}: ${error.message}`);
    }
  }
}

module.exports = {
  isAdmin,
  getAdminIds,
  notifyAdmins,
  notifyAdminsAboutUpdate
};