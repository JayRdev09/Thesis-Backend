const express = require('express');
const router = express.Router();
const supabaseService = require('../services/supabaseService');

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

// Add growth assessment
router.post('/:plantId/assessments', authenticateToken, async (req, res) => {
  try {
    const { plantId } = req.params;
    
    // Log the entire request body to debug
    console.log('📥 Request body:', req.body);
    
    const {
      estimated_age_months,
      growth_stage,
      node_count,
      height_cm,
      stem_diameter_cm,
      stem_base_condition,
      flower_clusters,
      fruit_clusters,
      ripe_fruits_count,
      harvest_count,
      leaf_condition,
      notes
    } = req.body;

    console.log(`📊 POST /growth/${plantId}/assessments - User: ${req.user.id}`);
    console.log('📊 Assessment data:', {
      estimated_age_months,
      growth_stage,
      node_count,
      height_cm,
      stem_diameter_cm,
      stem_base_condition,
      flower_clusters,
      fruit_clusters,
      ripe_fruits_count,
      harvest_count,
      leaf_condition,
      notes
    });

    // Verify plant belongs to user
    const { data: plant, error: plantError } = await supabaseService.client
      .from('plants')
      .select('id')
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

    // Prepare assessment data with all columns
    const assessmentData = {
      plant_id: plantId,
      assessment_date: new Date(),
      created_at: new Date()
    };

    // Only add fields if they are provided (not undefined)
    if (estimated_age_months !== undefined) assessmentData.estimated_age_months = estimated_age_months;
    if (growth_stage !== undefined) assessmentData.growth_stage = growth_stage;
    if (node_count !== undefined) assessmentData.node_count = node_count;
    if (height_cm !== undefined) assessmentData.height_cm = height_cm;
    if (stem_diameter_cm !== undefined) assessmentData.stem_diameter_cm = stem_diameter_cm;
    if (stem_base_condition !== undefined) assessmentData.stem_base_condition = stem_base_condition;
    if (flower_clusters !== undefined) assessmentData.flower_clusters = flower_clusters;
    if (fruit_clusters !== undefined) assessmentData.fruit_clusters = fruit_clusters;
    if (ripe_fruits_count !== undefined) assessmentData.ripe_fruits_count = ripe_fruits_count;
    if (harvest_count !== undefined) assessmentData.harvest_count = harvest_count;
    if (leaf_condition !== undefined) assessmentData.leaf_condition = leaf_condition;
    if (notes !== undefined) assessmentData.notes = notes;

    console.log('📦 Inserting assessment data:', assessmentData);

    // Insert assessment with all columns
    const { data, error } = await supabaseService.client
      .from('growth_assessments')
      .insert([assessmentData])
      .select();

    if (error) {
      console.error('❌ Supabase insert error:', error);
      throw error;
    }

    console.log('✅ Growth assessment added:', data[0]);
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('❌ Error adding assessment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get growth history
router.get('/:plantId/assessments', authenticateToken, async (req, res) => {
  try {
    const { plantId } = req.params;
    
    console.log(`📊 GET /growth/${plantId}/assessments - User: ${req.user.id}`);

    const { data, error } = await supabaseService.client
      .from('growth_assessments')
      .select('*')
      .eq('plant_id', plantId)
      .order('assessment_date', { ascending: false });

    if (error) throw error;

    console.log(`📊 Found ${data?.length || 0} assessments`);
    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('❌ Error fetching growth history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get latest assessment
router.get('/:plantId/assessments/latest', authenticateToken, async (req, res) => {
  try {
    const { plantId } = req.params;
    
    console.log(`📊 GET /growth/${plantId}/assessments/latest - User: ${req.user.id}`);

    const { data, error } = await supabaseService.client
      .from('growth_assessments')
      .select('*')
      .eq('plant_id', plantId)
      .order('assessment_date', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ 
          success: false, 
          error: 'No assessments found' 
        });
      }
      throw error;
    }

    console.log('📊 Latest assessment:', data);
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ Error fetching latest assessment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get assessment by ID
router.get('/assessments/:assessmentId', authenticateToken, async (req, res) => {
  try {
    const { assessmentId } = req.params;
    
    console.log(`📊 GET /growth/assessments/${assessmentId} - User: ${req.user.id}`);

    const { data, error } = await supabaseService.client
      .from('growth_assessments')
      .select(`
        *,
        plants:plant_id (
          id,
          name,
          user_id
        )
      `)
      .eq('id', assessmentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ 
          success: false, 
          error: 'Assessment not found' 
        });
      }
      throw error;
    }

    // Verify the plant belongs to the user
    if (data.plants.user_id !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied' 
      });
    }

    // Remove plants data from response
    delete data.plants;
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('❌ Error fetching assessment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;