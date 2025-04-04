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
 * @returns {Promise<void>}
 */
async function notifyAdmins(bot, applicant) {
  const adminIds = getAdminIds();
  
  for (const adminId of adminIds) {
    try {
      await bot.telegram.sendMessage(
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
      logger.info(`Notification sent to admin ${adminId} about application from user ${applicant.userId}`);
    } catch (error) {
      logger.error(`Failed to notify admin ${adminId}: ${error.message}`);
    }
  }
}

module.exports = {
  isAdmin,
  getAdminIds,
  notifyAdmins
};