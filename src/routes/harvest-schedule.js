const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabaseService');
const plantAgeService = require('../services/plantAgeService');
const ruleBasedPredictor = require('../services/ruleBasedPredictor');
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

// Get prediction options (dropdown values)
router.get('/options', authenticateToken, async (req, res) => {
  try {
    const options = ruleBasedPredictor.getInputOptions();
    res.json({
      success: true,
      options
    });
  } catch (error) {
    console.error('❌ Error getting options:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Predict harvest for a specific plant
router.post('/predict/:plantId', authenticateToken, async (req, res) => {
  try {
    const { plantId } = req.params;
    const userInputs = req.body;

    console.log(`🌾 POST /harvest-schedule/predict/${plantId} - User: ${req.user.id}`);
    console.log('📦 User inputs:', userInputs);

    // Verify plant belongs to user
    const { data: plant, error: plantError } = await supabaseService.client
      .from('plants')
      .select('*')
      .eq('id', plantId)
      .eq('user_id', req.user.id)
      .single();

    if (plantError) {
      if (plantError.code === 'PGRST116') {
        return res.status(404).json({ 
          success: false, 
          error: 'Plant not found' 
        });
      }
      throw plantError;
    }

    // Get latest assessment if available
    const { data: latestAssessment } = await supabaseService.client
      .from('growth_assessments')
      .select('*')
      .eq('plant_id', plantId)
      .order('assessment_date', { ascending: false })
      .limit(1)
      .single();

    // Combine plant data with user inputs and latest assessment
    const predictionInputs = {
      plantId: plant.id,
      plantName: plant.plant_name,
      growthStage: plant.growth_stage,
      estimatedAgeMonths: plant.estimated_age_months,
      // Override with user inputs
      ...userInputs,
      // Add latest assessment data if not overridden
      hasFlowers: userInputs.hasFlowers ?? (latestAssessment?.flower_clusters > 0),
      hasGreenFruits: userInputs.hasGreenFruits ?? (latestAssessment?.fruit_clusters > 0 && !latestAssessment?.ripe_fruits_count),
      hasRipeFruits: userInputs.hasRipeFruits ?? (latestAssessment?.ripe_fruits_count > 0),
      height: userInputs.height ?? latestAssessment?.height_cm,
      leafCondition: userInputs.leafCondition ?? latestAssessment?.leaf_condition
    };

    // Get prediction
    const prediction = ruleBasedPredictor.predict(predictionInputs);

    // Generate calendar
    const calendar = plantAgeService.generateHarvestCalendar(plantId, prediction);

    // Store prediction in database
    const { data: storedPrediction, error: storeError } = await supabaseService.client
      .from('harvest_predictions')
      .insert([{
        plant_id: plantId,
        user_id: req.user.id,
        predicted_date: prediction.prediction.predictedDate,
        days_to_harvest: prediction.prediction.daysToHarvest,
        confidence: prediction.prediction.confidence,
        inputs: predictionInputs,
        prediction_data: prediction,
        created_at: new Date()
      }])
      .select();

    if (storeError) {
      console.error('⚠️ Could not store prediction:', storeError);
      // Continue anyway - prediction is still valid
    }

    res.json({
      success: true,
      plant: {
        id: plant.id,
        name: plant.plant_name
      },
      prediction: prediction.prediction,
      calendar,
      storedPredictionId: storedPrediction?.[0]?.id
    });
    
    // Log successful harvest prediction
    await loggingService.logPlantActivity(
      req.user.id,
      'HARVEST_PREDICTION_CREATED',
      `Predicted harvest for plant "${plant.plant_name}": ${prediction.prediction.daysToHarvest} days, confidence: ${prediction.prediction.confidence}%`
    );
  } catch (error) {
    console.error('❌ Error predicting harvest:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Quick prediction without saving to plant
router.post('/quick-predict', authenticateToken, async (req, res) => {
  try {
    const userInputs = req.body;
    
    console.log('⚡ Quick harvest prediction - User:', req.user.id);
    console.log('📦 Inputs:', userInputs);

    const prediction = ruleBasedPredictor.predict(userInputs);

    res.json({
      success: true,
      prediction: prediction.prediction,
      inputs: userInputs
    });
  } catch (error) {
    console.error('❌ Error in quick prediction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch predict for multiple plants
router.post('/batch-predict', authenticateToken, async (req, res) => {
  try {
    const { plants } = req.body;
    
    console.log(`📊 Batch harvest prediction for ${plants?.length || 0} plants - User: ${req.user.id}`);

    if (!plants || !Array.isArray(plants)) {
      return res.status(400).json({
        success: false,
        error: 'Plants array is required'
      });
    }

    const results = await Promise.all(plants.map(async (plantInput) => {
      // If plantId is provided, fetch plant data
      if (plantInput.plantId) {
        const { data: plant } = await supabaseService.client
          .from('plants')
          .select('*')
          .eq('id', plantInput.plantId)
          .eq('user_id', req.user.id)
          .single();

        if (plant) {
          plantInput.plantName = plant.plant_name;
        }
      }

      return {
        ...plantInput,
        prediction: ruleBasedPredictor.predict(plantInput).prediction
      };
    }));

    // Sort by days to harvest
    results.sort((a, b) => a.prediction.daysToHarvest - b.prediction.daysToHarvest);

    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        readyNow: results.filter(r => r.prediction.daysToHarvest === 0).length,
        readyThisWeek: results.filter(r => r.prediction.daysToHarvest > 0 && r.prediction.daysToHarvest <= 7).length,
        readyThisMonth: results.filter(r => r.prediction.daysToHarvest > 7 && r.prediction.daysToHarvest <= 30).length
      }
    });
  } catch (error) {
    console.error('❌ Error in batch prediction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get prediction history for a plant
router.get('/history/:plantId', authenticateToken, async (req, res) => {
  try {
    const { plantId } = req.params;
    const { limit = 10 } = req.query;

    console.log(`📜 GET /harvest-schedule/history/${plantId} - User: ${req.user.id}`);

    // FIXED: Added .client to supabaseService
    const { data, error } = await supabaseService.client
      .from('harvest_predictions')
      .select('*')
      .eq('plant_id', plantId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({
      success: true,
      history: data || []
    });
    
    // Log harvest history access
    await loggingService.logPlantActivity(
      req.user.id,
      'VIEW_HARVEST_HISTORY',
      `Viewed ${data?.length || 0} harvest predictions for plant ${plantId}`
    );
  } catch (error) {
    console.error('❌ Error fetching prediction history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update prediction with actual harvest date
router.post('/confirm/:predictionId', authenticateToken, async (req, res) => {
  try {
    const { predictionId } = req.params;
    const { actualHarvestDate, accuracy } = req.body;

    console.log(`✅ Confirming prediction ${predictionId} - User: ${req.user.id}`);

    // FIXED: Added .client to supabaseService
    const { data, error } = await supabaseService.client
      .from('harvest_predictions')
      .update({
        actual_harvest_date: actualHarvestDate || new Date().toISOString().split('T')[0],
        accuracy_rating: accuracy,
        confirmed_at: new Date()
      })
      .eq('id', predictionId)
      .eq('user_id', req.user.id)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Prediction confirmed',
      data: data[0]
    });
    
    // Log harvest confirmation
    await loggingService.logPlantActivity(
      req.user.id,
      'HARVEST_CONFIRMED',
      `Confirmed harvest prediction ${predictionId} with accuracy rating: ${accuracy || 'N/A'}`
    );
  } catch (error) {
    console.error('❌ Error confirming prediction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;