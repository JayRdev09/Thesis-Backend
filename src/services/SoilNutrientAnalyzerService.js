const path = require('path');
const fs = require('fs');
const supabaseService = require('./supabaseService');

class SoilNutrientAnalyzerService {
    constructor() {
        console.log('🌱 Soil Nutrient Analyzer Service initialized');
        
        // SCIENTIFIC OPTIMAL RANGES for Tomatoes
        this.optimalRanges = {
            ph: {
                min: 6.0,
                max: 7.0,
                ideal: 6.5,
                description: 'Slightly acidic to near-neutral pH optimizes nutrient availability'
            },
            moisture: {
                min: 60,
                max: 75,
                ideal: 67.5,
                description: '60-75% of field capacity supports photosynthesis and fruit enlargement'
            },
            temperature: {
                min: 20,
                max: 25,
                ideal: 22.5,
                description: 'Optimal daytime temperature for growth and fruit yield'
            },
            nitrogen: {
                min: 80,
                max: 120,
                ideal: 100,
                description: 'Based on optimal N:P:K ratio of 2:1.33:12'
            },
            phosphorus: {
                min: 50,
                max: 80,
                ideal: 66.5,
                description: 'Based on optimal N:P:K ratio of 2:1.33:12'
            },
            potassium: {
                min: 450,
                max: 650,
                ideal: 600,
                description: 'Based on optimal N:P:K ratio of 2:1.33:12'
            }
        };
        
        // Parameter weights for scoring
        this.weights = {
            ph: 0.20,
            moisture: 0.15,
            temperature: 0.10,
            nitrogen: 0.20,
            phosphorus: 0.15,
            potassium: 0.20
        };
    }

    async analyzeTomatoSuitability(userId, soilId = null) {
        try {
            console.log(`🍅 Analyzing soil for tomato suitability - User: ${userId}`);
            
            let soilData;
            
            if (soilId) {
                soilData = await supabaseService.getSoilData(soilId, userId);
                if (!soilData) {
                    throw new Error(`Soil data not found for ID: ${soilId}`);
                }
            } else {
                soilData = await supabaseService.getLatestSoilData(userId);
                if (!soilData) {
                    throw new Error('No soil data found for this user');
                }
            }
            
            console.log('📊 Soil data retrieved:', soilData);
            
            // Validate soil data
            const validation = this._validateSoilData(soilData);
            if (!validation.valid) {
                throw new Error(validation.error);
            }
            
            // Check data freshness
            const freshness = this._checkFreshness(soilData.date_gathered);
            
            // Analyze tomato suitability
            const analysis = this._analyzeTomatoSuitability(soilData);
            
            // Add freshness info
            analysis.data_freshness = freshness;
            
            console.log('✅ Tomato suitability analysis completed');
            console.log('📊 Result:', JSON.stringify(analysis, null, 2));
            
            return {
                success: true,
                analysis: analysis,
                soil_data: {
                    ph_level: soilData.ph_level,
                    moisture: soilData.moisture,
                    temperature: soilData.temperature,
                    nitrogen: soilData.nitrogen,
                    phosphorus: soilData.phosphorus,
                    potassium: soilData.potassium,
                    date_gathered: soilData.date_gathered
                },
                metadata: {
                    user_id: userId,
                    soil_id: soilData.soil_id || soilData.id,
                    analyzed_at: new Date().toISOString(),
                    analysis_method: 'Rule-Based (Scientific Standards)'
                }
            };
            
        } catch (error) {
            console.error('❌ Tomato suitability analysis failed:', error);
            return {
                success: false,
                error: error.message || 'Unknown error during analysis',
                timestamp: new Date().toISOString()
            };
        }
    }

    _validateSoilData(soilData) {
        const requiredFields = ['ph_level', 'moisture', 'temperature', 'nitrogen', 'phosphorus', 'potassium'];
        const missingFields = [];
        
        for (const field of requiredFields) {
            if (soilData[field] === null || soilData[field] === undefined) {
                missingFields.push(field);
                continue;
            }
            
            const value = parseFloat(soilData[field]);
            if (isNaN(value)) {
                return {
                    valid: false,
                    error: `Invalid ${field}: must be a number`
                };
            }
        }
        
        if (missingFields.length > 0) {
            return {
                valid: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            };
        }
        
        return { valid: true };
    }

    _checkFreshness(dateGathered) {
        if (!dateGathered) {
            return {
                isFresh: false,
                hoursOld: null,
                status: 'unknown',
                message: 'No timestamp available'
            };
        }
        
        const now = new Date();
        const dataDate = new Date(dateGathered);
        const hoursDiff = (now - dataDate) / (1000 * 60 * 60);
        
        let status, message;
        if (hoursDiff <= 24) {
            status = 'fresh';
            message = 'Data is current (less than 24 hours old)';
        } else {
            status = 'stale';
            message = `Data is ${Math.round(hoursDiff)} hours old. Refresh recommended.`;
        }
        
        return {
            isFresh: hoursDiff <= 24,
            hoursOld: Math.round(hoursDiff * 10) / 10,
            status: status,
            message: message
        };
    }

    _analyzeTomatoSuitability(soilData) {
        // Extract and parse values
        const ph = parseFloat(soilData.ph_level);
        const moisture = parseFloat(soilData.moisture);
        const temperature = parseFloat(soilData.temperature);
        const nitrogen = parseFloat(soilData.nitrogen);
        const phosphorus = parseFloat(soilData.phosphorus);
        const potassium = parseFloat(soilData.potassium);
        
        console.log(`📊 Analyzing values: pH=${ph}, Moisture=${moisture}%, Temp=${temperature}°C, N=${nitrogen}ppm, P=${phosphorus}ppm, K=${potassium}ppm`);
        
        // Calculate NPK ratio
        const npkRatio = {
            n: nitrogen,
            p: phosphorus,
            k: potassium,
            ratio: `${(nitrogen/50).toFixed(1)}:${(phosphorus/50).toFixed(1)}:${(potassium/50).toFixed(1)}`,
            optimalRatio: '2:1.33:12'
        };
        
        // Check each parameter and collect issues
        const issues = [];
        const parameterStatus = {};
        let totalScore = 0;
        const maxScore = 600; // 100 points per parameter
        
        // Check pH
        if (ph < this.optimalRanges.ph.min) {
            issues.push(`pH is too low (${ph}). Optimal range: ${this.optimalRanges.ph.min}-${this.optimalRanges.ph.max}`);
            parameterStatus.ph = 'low';
            totalScore += 50; // Partial score for being close
        } else if (ph > this.optimalRanges.ph.max) {
            issues.push(`pH is too high (${ph}). Optimal range: ${this.optimalRanges.ph.min}-${this.optimalRanges.ph.max}`);
            parameterStatus.ph = 'high';
            totalScore += 50;
        } else {
            parameterStatus.ph = 'optimal';
            totalScore += 100;
        }
        
        // Check Moisture
        if (moisture < this.optimalRanges.moisture.min) {
            issues.push(`Moisture is too low (${moisture}%). Optimal range: ${this.optimalRanges.moisture.min}-${this.optimalRanges.moisture.max}%`);
            parameterStatus.moisture = 'low';
            totalScore += 50;
        } else if (moisture > this.optimalRanges.moisture.max) {
            issues.push(`Moisture is too high (${moisture}%). Optimal range: ${this.optimalRanges.moisture.min}-${this.optimalRanges.moisture.max}%`);
            parameterStatus.moisture = 'high';
            totalScore += 50;
        } else {
            parameterStatus.moisture = 'optimal';
            totalScore += 100;
        }
        
        // Check Temperature
        if (temperature < this.optimalRanges.temperature.min) {
            issues.push(`Temperature is too low (${temperature}°C). Optimal range: ${this.optimalRanges.temperature.min}-${this.optimalRanges.temperature.max}°C`);
            parameterStatus.temperature = 'low';
            totalScore += 50;
        } else if (temperature > this.optimalRanges.temperature.max) {
            issues.push(`Temperature is too high (${temperature}°C). Optimal range: ${this.optimalRanges.temperature.min}-${this.optimalRanges.temperature.max}°C`);
            parameterStatus.temperature = 'high';
            totalScore += 50;
        } else {
            parameterStatus.temperature = 'optimal';
            totalScore += 100;
        }
        
        // Check Nitrogen
        if (nitrogen < this.optimalRanges.nitrogen.min) {
            issues.push(`Nitrogen is too low (${nitrogen} ppm). Optimal range: ${this.optimalRanges.nitrogen.min}-${this.optimalRanges.nitrogen.max} ppm`);
            parameterStatus.nitrogen = 'low';
            totalScore += 50;
        } else if (nitrogen > this.optimalRanges.nitrogen.max) {
            issues.push(`Nitrogen is too high (${nitrogen} ppm). Optimal range: ${this.optimalRanges.nitrogen.min}-${this.optimalRanges.nitrogen.max} ppm`);
            parameterStatus.nitrogen = 'high';
            totalScore += 50;
        } else {
            parameterStatus.nitrogen = 'optimal';
            totalScore += 100;
        }
        
        // Check Phosphorus
        if (phosphorus < this.optimalRanges.phosphorus.min) {
            issues.push(`Phosphorus is too low (${phosphorus} ppm). Optimal range: ${this.optimalRanges.phosphorus.min}-${this.optimalRanges.phosphorus.max} ppm`);
            parameterStatus.phosphorus = 'low';
            totalScore += 50;
        } else if (phosphorus > this.optimalRanges.phosphorus.max) {
            issues.push(`Phosphorus is too high (${phosphorus} ppm). Optimal range: ${this.optimalRanges.phosphorus.min}-${this.optimalRanges.phosphorus.max} ppm`);
            parameterStatus.phosphorus = 'high';
            totalScore += 50;
        } else {
            parameterStatus.phosphorus = 'optimal';
            totalScore += 100;
        }
        
        // Check Potassium
        if (potassium < this.optimalRanges.potassium.min) {
            issues.push(`Potassium is too low (${potassium} ppm). Optimal range: ${this.optimalRanges.potassium.min}-${this.optimalRanges.potassium.max} ppm`);
            parameterStatus.potassium = 'low';
            totalScore += 50;
        } else if (potassium > this.optimalRanges.potassium.max) {
            issues.push(`Potassium is too high (${potassium} ppm). Optimal range: ${this.optimalRanges.potassium.min}-${this.optimalRanges.potassium.max} ppm`);
            parameterStatus.potassium = 'high';
            totalScore += 50;
        } else {
            parameterStatus.potassium = 'optimal';
            totalScore += 100;
        }
        
        // Check NPK Ratio alignment with 2:1.33:12
        const expectedP = nitrogen * 1.33 / 2; // Based on N:P ratio
        const expectedK = nitrogen * 12 / 2; // Based on N:K ratio
        
        const pDeviation = Math.abs(phosphorus - expectedP) / expectedP * 100;
        const kDeviation = Math.abs(potassium - expectedK) / expectedK * 100;
        
        if (pDeviation > 30) {
            issues.push(`Phosphorus level (${phosphorus} ppm) deviates from optimal ratio. Expected ~${expectedP.toFixed(1)} ppm based on nitrogen level.`);
        }
        if (kDeviation > 30) {
            issues.push(`Potassium level (${potassium} ppm) deviates from optimal ratio. Expected ~${expectedK.toFixed(0)} ppm based on nitrogen level.`);
        }
        
        // Calculate score percentage
        const scorePercentage = Math.round((totalScore / maxScore) * 100);
        
        // Determine suitability
        let isSuitable = false;
        let suitabilityLevel = '';
        let summary = '';
        
        if (scorePercentage >= 80) {
            isSuitable = true;
            suitabilityLevel = 'Excellent';
            summary = 'Soil is excellently suited for tomato cultivation!';
        } else if (scorePercentage >= 60) {
            isSuitable = true;
            suitabilityLevel = 'Good';
            summary = 'Soil is good for tomatoes with minor adjustments.';
        } else if (scorePercentage >= 40) {
            isSuitable = false;
            suitabilityLevel = 'Fair';
            summary = 'Soil needs improvement before planting tomatoes.';
        } else {
            isSuitable = false;
            suitabilityLevel = 'Poor';
            summary = 'Soil is not suitable for tomatoes without major amendments.';
        }
        
        console.log(`📊 Score: ${scorePercentage}%, Suitable: ${isSuitable}, Level: ${suitabilityLevel}`);
        
        return {
            is_suitable_for_tomatoes: isSuitable,
            suitability_level: suitabilityLevel,
            suitability_score: scorePercentage,
            summary: summary,
            parameters: {
                ph: {
                    value: ph,
                    status: parameterStatus.ph,
                    optimal_range: [this.optimalRanges.ph.min, this.optimalRanges.ph.max],
                    description: this.optimalRanges.ph.description
                },
                moisture: {
                    value: moisture,
                    status: parameterStatus.moisture,
                    optimal_range: [this.optimalRanges.moisture.min, this.optimalRanges.moisture.max],
                    description: this.optimalRanges.moisture.description
                },
                temperature: {
                    value: temperature,
                    status: parameterStatus.temperature,
                    optimal_range: [this.optimalRanges.temperature.min, this.optimalRanges.temperature.max],
                    description: this.optimalRanges.temperature.description
                },
                nitrogen: {
                    value: nitrogen,
                    status: parameterStatus.nitrogen,
                    optimal_range: [this.optimalRanges.nitrogen.min, this.optimalRanges.nitrogen.max],
                    description: this.optimalRanges.nitrogen.description
                },
                phosphorus: {
                    value: phosphorus,
                    status: parameterStatus.phosphorus,
                    optimal_range: [this.optimalRanges.phosphorus.min, this.optimalRanges.phosphorus.max],
                    description: this.optimalRanges.phosphorus.description
                },
                potassium: {
                    value: potassium,
                    status: parameterStatus.potassium,
                    optimal_range: [this.optimalRanges.potassium.min, this.optimalRanges.potassium.max],
                    description: this.optimalRanges.potassium.description
                }
            },
            npk_ratio: npkRatio,
            issues: issues.length > 0 ? issues : ['All parameters within optimal ranges'],
            research_references: [
                {
                    source: 'Jing et al., 2025',
                    finding: 'N:P:K ratio of approximately 2:1.33:12 significantly improved tomato growth, yield, and fruit quality'
                },
                {
                    source: 'Studies on soil chemical properties',
                    finding: 'pH 6.0–6.8 optimizes nutrient availability and uptake'
                },
                {
                    source: 'Liu, 2019',
                    finding: 'Soil moisture at 60–70% of field capacity supports photosynthesis and fruit enlargement'
                },
                {
                    source: 'Tokić et al., 2023',
                    finding: 'Daytime temperatures 20–25°C optimal for growth and fruit yield'
                }
            ]
        };
    }

    async getSoilDataById(soilId, userId) {
        try {
            return await supabaseService.getSoilData(soilId, userId);
        } catch (error) {
            console.error('Error fetching soil data:', error);
            throw error;
        }
    }

    async getLatestSoilData(userId) {
        try {
            return await supabaseService.getLatestSoilData(userId);
        } catch (error) {
            console.error('Error fetching latest soil data:', error);
            throw error;
        }
    }
}

module.exports = new SoilNutrientAnalyzerService();