const logger = require('../utils/logger');

/**
 * Проверяет, является ли пользователь участником группы
 * @param {Object} bot - Экземпляр Telegraf бота
 * @param {number} userId - ID пользователя Telegram
 * @param {string} groupId - ID группы
 * @returns {Promise<boolean>} - true если пользователь является участником группы
 */
async function isUserMember(bot, userId, groupId) {
  try {
    // Пытаемся получить статус пользователя в группе
    const chatMember = await bot.telegram.getChatMember(groupId, userId);
    
    // Проверяем статус - если не 'left' и не 'kicked', значит пользователь в группе
    const isMember = chatMember && 
                    ['creator', 'administrator', 'member', 'restricted'].includes(chatMember.status);
    
    logger.info(`User ${userId} membership check in group ${groupId}: ${isMember ? 'is member' : 'is not member'}`);
    return isMember;
  } catch (error) {
    // Если произошла ошибка 'user not found', значит пользователь не в группе
    if (error.description && (
        error.description.includes('user not found') || 
        error.description.includes('chat not found') ||
        error.description.includes('user is not a member'))) {
      logger.info(`User ${userId} is not a member of group ${groupId}`);
      return false;
    }
    
    // Для других ошибок логируем и возвращаем false
    logger.error(`Error checking user membership: ${error.message}`);
    return false;
  }
}

module.exports = {
  isUserMember
};