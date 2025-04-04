const Application = require('../models/application');
const logger = require('../utils/logger');

/**
 * Сохраняет новую заявку на вступление
 * @param {Object} applicantData - Данные заявителя
 * @returns {Promise<Object>} - Сохраненная заявка
 */
async function saveApplication(applicantData) {
  try {
    // Проверка на существующую заявку
    const existingApplication = await Application.findOne({
      userId: applicantData.userId,
      status: 'pending'
    });

    if (existingApplication) {
      logger.info(`User ${applicantData.userId} already has a pending application`);
      return existingApplication;
    }

    // Создание новой заявки
    const application = new Application(applicantData);
    await application.save();
    logger.info(`New application saved for user ${applicantData.userId}`);
    return application;
  } catch (error) {
    logger.error(`Error saving application: ${error.message}`);
    throw error;
  }
}

/**
 * Обновляет статус заявки
 * @param {number} userId - ID пользователя Telegram
 * @param {string} status - Новый статус заявки ('approved' или 'rejected')
 * @param {number} adminId - ID администратора, обработавшего заявку
 * @param {string} inviteLink - Ссылка-приглашение (только если статус 'approved')
 * @returns {Promise<Object>} - Обновленная заявка
 */
async function updateApplicationStatus(userId, status, adminId, inviteLink = null) {
  try {
    const application = await Application.findOne({ userId, status: 'pending' });
    
    if (!application) {
      logger.warn(`No pending application found for user ${userId}`);
      return null;
    }
    
    application.status = status;
    application.processedBy = adminId;
    application.processedAt = new Date();
    
    if (status === 'approved' && inviteLink) {
      application.inviteLink = inviteLink;
    }
    
    await application.save();
    logger.info(`Application for user ${userId} updated to status "${status}" by admin ${adminId}`);
    return application;
  } catch (error) {
    logger.error(`Error updating application status: ${error.message}`);
    throw error;
  }
}

/**
 * Проверяет наличие ожидающей заявки от пользователя
 * @param {number} userId - ID пользователя Telegram
 * @returns {Promise<boolean>} - true если заявка существует
 */
async function hasPendingApplication(userId) {
  try {
    const count = await Application.countDocuments({ userId, status: 'pending' });
    return count > 0;
  } catch (error) {
    logger.error(`Error checking pending application: ${error.message}`);
    throw error;
  }
}

module.exports = {
  saveApplication,
  updateApplicationStatus,
  hasPendingApplication
};