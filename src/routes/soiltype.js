const express = require('express');
const router = express.Router();
const soilNutrientAnalyzer = require('../services/SoilNutrientAnalyzerService');
const supabaseService = require('../services/supabaseService');

/**
 * @route POST /api/soiltype/analyze
 * @description Analyze soil for tomato suitability using latest soil data
 * @access Private
 */
router.post('/analyze', async (req, res) => {
    try {
        console.log('🍅 Received tomato suitability analysis request');
        
        const { soil_id, user_id } = req.body;
        
        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'user_id is required'
            });
        }
        
        // Analyze tomato suitability (with optional soil_id)
        console.log(`🔬 Analyzing tomato suitability for user: ${user_id}`);
        const analysisResult = await soilNutrientAnalyzer.analyzeTomatoSuitability(user_id, soil_id || null);
        
        if (!analysisResult.success) {
            return res.status(500).json(analysisResult);
        }
        
        // Emit real-time update via socket if available
        try {
            const io = req.app.get('io');
            if (io && analysisResult.success) {
                const roomName = `soil:${user_id}`;
                
                // Create a simplified real-time update
                const realtimeUpdate = {
                    type: 'tomato_suitability_analysis',
                    is_suitable: analysisResult.analysis.is_suitable_for_tomatoes,
                    suitability_level: analysisResult.analysis.suitability_level,
                    suitability_score: analysisResult.analysis.suitability_score,
                    timestamp: new Date().toISOString(),
                    soil_id: analysisResult.metadata.soil_id
                };
                
                io.to(roomName).emit('soil-analysis-update', realtimeUpdate);
                console.log(`📡 Tomato suitability update emitted to room: ${roomName}`);
            }
        } catch (socketError) {
            console.warn('⚠️ Could not emit socket update:', socketError.message);
        }
        
        // Return analysis results
        res.json({
            success: true,
            message: 'Tomato suitability analysis completed',
            analysis: analysisResult.analysis,
            soil_data: analysisResult.soil_data,
            metadata: {
                user_id: user_id,
                soil_id: analysisResult.metadata.soil_id,
                analyzed_at: analysisResult.metadata.analyzed_at,
                analysis_method: analysisResult.metadata.analysis_method
            }
        });
        
    } catch (error) {
        console.error('❌ Tomato suitability analysis route error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route POST /api/soiltype/analyze-direct
 * @description Analyze soil data directly for tomato suitability
 * @access Private
 */
router.post('/analyze-direct', async (req, res) => {
    try {
        console.log('📊 Direct tomato suitability analysis request');
        
        const soilData = req.body;
        
        // Validate required fields
        const requiredFields = ['ph_level', 'moisture', 'temperature', 'nitrogen', 'phosphorus', 'potassium'];
        for (const field of requiredFields) {
            if (!(field in soilData)) {
                return res.status(400).json({
                    success: false,
                    error: `Missing field: ${field}`
                });
            }
        }
        
        // Validate that values are numbers
        for (const field of requiredFields) {
            const value = parseFloat(soilData[field]);
            if (isNaN(value)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid ${field}: must be a number`
                });
            }
        }
        
        // Create a complete soil data object with required fields
        const completeSoilData = {
            ph_level: parseFloat(soilData.ph_level),
            moisture: parseFloat(soilData.moisture),
            temperature: parseFloat(soilData.temperature),
            nitrogen: parseFloat(soilData.nitrogen),
            phosphorus: parseFloat(soilData.phosphorus),
            potassium: parseFloat(soilData.potassium),
            user_id: soilData.user_id || 'direct_analysis',
            soil_id: soilData.soil_id || `direct_${Date.now()}`,
            date_gathered: soilData.date_gathered || new Date().toISOString()
        };
        
        // Create a mock user ID for the analyzer
        const userId = soilData.user_id || 'direct_analysis';
        
        // Use the analyzer's internal method directly
        const analysis = soilNutrientAnalyzer._analyzeTomatoSuitability(completeSoilData);
        
        // Return results
        res.json({
            success: true,
            message: 'Direct tomato suitability analysis completed',
            analysis: analysis,
            soil_data: {
                ph_level: completeSoilData.ph_level,
                moisture: completeSoilData.moisture,
                temperature: completeSoilData.temperature,
                nitrogen: completeSoilData.nitrogen,
                phosphorus: completeSoilData.phosphorus,
                potassium: completeSoilData.potassium
            },
            metadata: {
                analysis_type: 'DIRECT',
                analyzed_at: new Date().toISOString(),
                analysis_method: 'Rule-Based (Scientific Standards)'
            }
        });
        
    } catch (error) {
        console.error('❌ Direct analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * @route GET /api/soiltype/latest/:user_id
 * @description Get latest soil data and analyze for tomato suitability
 * @access Private
 */
router.get('/latest/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;
        
        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'user_id is required'
            });
        }
        
        console.log(`📊 Getting latest soil data and analyzing for user: ${user_id}`);
        
        // Get latest soil data
        const soilData = await supabaseService.getLatestSoilData(user_id);
        
        if (!soilData) {
            return res.status(404).json({
                success: false,
                error: 'No soil data found for this user'
            });
        }
        
        // Analyze tomato suitability
        const analysis = soilNutrientAnalyzer._analyzeTomatoSuitability(soilData);
        
        res.json({
            success: true,
            message: 'Latest soil data analyzed for tomato suitability',
            soil_data: {
                ph_level: soilData.ph_level,
                moisture: soilData.moisture,
                temperature: soilData.temperature,
                nitrogen: soilData.nitrogen,
                phosphorus: soilData.phosphorus,
                potassium: soilData.potassium,
                date_gathered: soilData.date_gathered
            },
            analysis: analysis,
            metadata: {
                user_id: user_id,
                soil_id: soilData.soil_id || soilData.id,
                analyzed_at: new Date().toISOString(),
                analysis_method: 'Rule-Based (Scientific Standards)'
            }
        });
        
    } catch (error) {
        console.error('❌ Latest soil analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * @route POST /api/soiltype/batch-analyze
 * @description Analyze multiple soil samples for tomato suitability
 * @access Private
 */
router.post('/batch-analyze', async (req, res) => {
    try {
        const { soil_ids, user_id } = req.body;
        
        if (!soil_ids || !Array.isArray(soil_ids) || soil_ids.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'soil_ids array is required'
            });
        }
        
        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'user_id is required'
            });
        }
        
        console.log(`📊 Batch analyzing ${soil_ids.length} soil samples for tomato suitability`);
        
        // Fetch all soil data
        const soilDataPromises = soil_ids.map(soil_id => 
            supabaseService.getSoilData(soil_id, user_id)
        );
        
        const soilDataArray = await Promise.all(soilDataPromises);
        
        // Filter out null results
        const validSoilData = soilDataArray.filter(data => data !== null);
        
        if (validSoilData.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No valid soil data found'
            });
        }
        
        // Analyze all soil samples
        const analysisResults = validSoilData.map(soilData => 
            soilNutrientAnalyzer._analyzeTomatoSuitability(soilData)
        );
        
        // Format results
        const formattedResults = validSoilData.map((soilData, index) => ({
            soil_id: soilData.soil_id || soilData.id,
            date_gathered: soilData.date_gathered,
            soil_parameters: {
                ph: soilData.ph_level,
                moisture: soilData.moisture,
                temperature: soilData.temperature,
                nitrogen: soilData.nitrogen,
                phosphorus: soilData.phosphorus,
                potassium: soilData.potassium
            },
            analysis: analysisResults[index]
        }));
        
        // Generate statistics
        const suitableCount = analysisResults.filter(a => a.is_suitable_for_tomatoes).length;
        const notSuitableCount = analysisResults.length - suitableCount;
        
        const statistics = {
            total_samples: analysisResults.length,
            suitable_for_tomatoes: suitableCount,
            not_suitable_for_tomatoes: notSuitableCount,
            suitability_rate: `${Math.round((suitableCount / analysisResults.length) * 100)}%`,
            average_score: Math.round(analysisResults.reduce((sum, a) => sum + a.suitability_score, 0) / analysisResults.length)
        };
        
        res.json({
            success: true,
            message: `Batch analysis completed for ${validSoilData.length} samples`,
            results: formattedResults,
            statistics: statistics,
            metadata: {
                analyzed_at: new Date().toISOString(),
                batch_size: soil_ids.length,
                valid_samples: validSoilData.length,
                analysis_method: 'Rule-Based (Scientific Standards)'
            }
        });
        
    } catch (error) {
        console.error('❌ Batch analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

/**
 * @route GET /api/soiltype/status
 * @description Check soil nutrient analyzer status
 * @access Public
 */
router.get('/status', async (req, res) => {
    try {
        // Test with sample data
        const testData = {
            ph_level: 6.5,
            moisture: 65,
            temperature: 23,
            nitrogen: 100,
            phosphorus: 66.5,
            potassium: 600
        };
        
        const analysis = soilNutrientAnalyzer._analyzeTomatoSuitability(testData);
        
        res.json({
            success: true,
            status: 'operational',
            service: 'Soil Nutrient Analyzer',
            version: '1.0.0',
            analysis_method: 'Rule-Based (Scientific Standards)',
            test_analysis: {
                is_suitable: analysis.is_suitable_for_tomatoes,
                suitability_level: analysis.suitability_level,
                score: analysis.suitability_score
            },
            research_references: analysis.research_references,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.json({
            success: false,
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;