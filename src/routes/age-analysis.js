const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabaseService'); // Fixed path
const plantAgeService = require('../services/plantAgeService'); // Fixed path
const loggingService = require('../services/loggingService');

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required'
      });
    }

    const accessToken = authHeader.split('Bearer ')[1];
    
    const { data, error } = await supabaseService.client.auth.getUser(accessToken);
    
    if (error) throw error;

    req.user = data.user;
    next();
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token'
    });
  }
};

// Analyze plant age
router.post('/analyze', authenticateToken, async (req, res) => {
  try {
    const characteristics = req.body;
    
    console.log(`🔍 POST /age-analysis/analyze - User: ${req.user.id}`);
    console.log('📊 Characteristics:', characteristics);

    // Estimate age
    const ageEstimate = plantAgeService.estimateAgeFromCharacteristics(characteristics);
    
    // Get predictions
    const predictions = plantAgeService.predictMilestones(
      ageEstimate.estimatedAgeMonths,
      ageEstimate.growthStage,
    );

    res.json({
      success: true,
      age_estimate: ageEstimate,
      predictions: predictions
    });
    
    // Log successful age analysis
    await loggingService.logPlantActivity(
      req.user.id,
      'AGE_ANALYSIS_COMPLETED',
      `Analyzed plant age: ${ageEstimate.estimatedAgeMonths} months, stage: ${ageEstimate.growthStage}`
    );
  } catch (error) {
    console.error('❌ Error analyzing age:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get growth timeline
router.get('/timeline/:plantId', authenticateToken, async (req, res) => {
  try {
    const { plantId } = req.params;
    
    console.log(`📊 GET /age-analysis/timeline/${plantId} - User: ${req.user.id}`);

    const { data: assessments, error } = await supabaseService
      .from('growth_assessments')
      .select('*')
      .eq('plant_id', plantId)
      .order('assessment_date', { ascending: true });

    if (error) throw error;

    // Format data for timeline visualization
    const timeline = assessments.map(assessment => ({
      date: assessment.assessment_date,
      age_months: assessment.estimated_age_months,
      stage: assessment.growth_stage,
      height: assessment.height_cm,
      nodes: assessment.node_count,
      flowers: assessment.flower_clusters,
      fruits: assessment.fruit_clusters,
      ripe_fruits: assessment.ripe_fruits_count
    }));

    res.json({
      success: true,
      timeline
    });
  } catch (error) {
    console.error('❌ Error fetching timeline:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;