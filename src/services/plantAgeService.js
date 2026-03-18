const supabaseService = require('./supabaseService');
const ruleBasedPredictor = require('./ruleBasedPredictor');

class PlantAgeService {
    
    // Growth stage parameters based on The Spruce (2025)
    static GROWTH_STAGES = {
        GERMINATION: { 
            name: 'germination', 
            label: 'Just Sprouted', 
            days: '6-8', 
            minDays: 6, 
            maxDays: 8,
            description: 'Seed sprouting, cotyledons appear',
            nextStage: 'early_growth',
            daysToHarvest: {
                min: 60, // Earliest possible harvest from germination
                max: 100 // Latest possible harvest from germination
            }
        },
        EARLY_GROWTH: { 
            name: 'early_growth', 
            label: 'Baby Plant', 
            days: '25-35', 
            minDays: 25, 
            maxDays: 35,
            description: 'Developing true leaves and root system',
            nextStage: 'vegetative',
            cumulativeDays: {
                min: 31, // 6+25
                max: 43  // 8+35
            },
            daysToHarvest: {
                min: 60 - 43, // At max early growth: 60-43 = 17 days left
                max: 100 - 31 // At min early growth: 100-31 = 69 days left
            }
        },
        VEGETATIVE: { 
            name: 'vegetative', 
            label: 'Growing Fast', 
            days: '20-25', 
            minDays: 20, 
            maxDays: 25,
            description: 'Vines lengthen, foliage grows',
            nextStage: 'flowering',
            cumulativeDays: {
                min: 51, // 31+20
                max: 68  // 43+25
            },
            daysToHarvest: {
                min: 60 - 68, // At max vegetative: 60-68 = -8 (already harvesting)
                max: 100 - 51 // At min vegetative: 100-51 = 49 days left
            }
        },
        FLOWERING: { 
            name: 'flowering', 
            label: 'Has Flowers', 
            days: '20+', 
            minDays: 20, 
            maxDays: 30,
            description: 'Yellow flowers appear',
            nextStage: 'pollination',
            cumulativeDays: {
                min: 71, // 51+20
                max: 98  // 68+30
            },
            daysToHarvest: {
                min: 60 - 98, // At max flowering: 60-98 = -38 (harvesting)
                max: 100 - 71 // At min flowering: 100-71 = 29 days left
            }
        },
        POLLINATION: { 
            name: 'pollination', 
            label: 'Being Pollinated', 
            days: '20+', 
            minDays: 20, 
            maxDays: 30,
            description: 'Flowers being pollinated, fruits starting',
            nextStage: 'fruit_formation',
            cumulativeDays: {
                min: 91, // 71+20
                max: 128 // 98+30
            },
            daysToHarvest: {
                min: 60 - 128, // At max pollination: 60-128 = -68 (past harvest)
                max: 100 - 91, // At min pollination: 100-91 = 9 days left
                average: Math.round((100 - 91 + 60 - 128) / 2) // Average days left
            }
        },
        FRUIT_FORMATION: { 
            name: 'fruit_formation', 
            label: 'Small Fruits', 
            days: '20-30', 
            minDays: 20, 
            maxDays: 30,
            description: 'Small green fruits form',
            nextStage: 'ripening',
            cumulativeDays: {
                min: 111, // 91+20
                max: 158 // 128+30
            },
            daysToHarvest: {
                min: 60 - 158, // Past harvest
                max: 100 - 111, // At min fruit formation: 100-111 = -11 (ready)
                average: 15 // Average days to harvest at this stage
            }
        },
        RIPENING: { 
            name: 'ripening', 
            label: 'Turning Red', 
            days: '15-20', 
            minDays: 15, 
            maxDays: 20,
            description: 'Fruits turn color',
            nextStage: 'harvest',
            cumulativeDays: {
                min: 126, // 111+15
                max: 178 // 158+20
            },
            daysToHarvest: {
                min: 0, // Ready now
                max: 100 - 126, // At min ripening: 100-126 = -26 (ready)
                average: 7 // Average days to harvest at this stage
            }
        },
        HARVEST: { 
            name: 'harvest', 
            label: 'Ready to Pick', 
            days: '0', 
            minDays: 0, 
            maxDays: 0,
            description: 'Ready to harvest!',
            nextStage: null,
            cumulativeDays: {
                min: 126,
                max: 178
            },
            daysToHarvest: {
                min: 0,
                max: 0,
                average: 0
            }
        }
    };

    // Calibrated cumulative days based on The Spruce (2025)
    static CUMULATIVE_DAYS = {
        germination: { min: 0, max: 8, daysToHarvestMin: 60, daysToHarvestMax: 100, averageDaysToHarvest: 80 },
        early_growth: { min: 6, max: 43, daysToHarvestMin: 17, daysToHarvestMax: 69, averageDaysToHarvest: 43 },
        vegetative: { min: 31, max: 68, daysToHarvestMin: 0, daysToHarvestMax: 49, averageDaysToHarvest: 35 },
        flowering: { min: 51, max: 98, daysToHarvestMin: 0, daysToHarvestMax: 29, averageDaysToHarvest: 25 },
        pollination: { min: 71, max: 128, daysToHarvestMin: 0, daysToHarvestMax: 9, averageDaysToHarvest: 20 },
        fruit_formation: { min: 91, max: 158, daysToHarvestMin: 0, daysToHarvestMax: 0, averageDaysToHarvest: 15 },
        ripening: { min: 106, max: 178, daysToHarvestMin: 0, daysToHarvestMax: 0, averageDaysToHarvest: 7 },
        harvest: { min: 126, max: 178, daysToHarvestMin: 0, daysToHarvestMax: 0, averageDaysToHarvest: 0 }
    };

    // Height thresholds calibrated to match The Spruce stages
    static HEIGHT_THRESHOLDS = {
        germination: { min: 0, max: 3 },
        early_growth: { min: 3, max: 15 },
        vegetative: { min: 15, max: 60 },
        flowering: { min: 60, max: 90 },
        pollination: { min: 90, max: 120 },
        fruit_formation: { min: 120, max: 150 },
        ripening: { min: 150, max: 180 }
    };

    /**
     * Estimate plant age based on physical characteristics
     * Based on The Spruce (2025) developmental stages
     */
    estimateAgeFromCharacteristics(characteristics) {
        const {
            nodeCount,
            heightCm,
            stemDiameterCm,
            stemBaseCondition,
            hasFlowers,
            hasGreenFruits,
            hasRipeFruits,
            harvestCount,
            leafCondition
        } = characteristics;

        let estimatedAge = 0;
        let confidenceFactors = [];
        let growthStage = 'unknown';
        let stageLabel = '';
        let daysToHarvest = 100; // Default max harvest period
        let harvestWindow = { min: 60, max: 100 };

        // SPECIAL CASE: End of life (beyond 178 days / ~6 months)
        if (harvestCount >= 10 || stemBaseCondition === 'thick_bark' || 
            (leafCondition === 'wilting' && !hasFlowers && !hasGreenFruits && !hasRipeFruits)) {
            growthStage = 'end_of_life';
            stageLabel = 'Plant Dying';
            estimatedAge = 6.0; // ~6 months
            daysToHarvest = 0;
            harvestWindow = { min: 0, max: 0 };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // GERMINATION STAGE (0-8 days, 0-3 cm)
        if ((!nodeCount || nodeCount === 0) && heightCm < 3 && !hasFlowers && !hasGreenFruits && !hasRipeFruits) {
            growthStage = 'germination';
            stageLabel = 'Just Sprouted';
            estimatedAge = 0.2; // ~6-8 days
            daysToHarvest = 80; // Average days to harvest
            harvestWindow = { min: 60, max: 100 };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // EARLY GROWTH STAGE (6-43 days, 3-15 cm)
        if (heightCm >= 3 && heightCm < 15 && !hasFlowers && !hasGreenFruits && !hasRipeFruits) {
            growthStage = 'early_growth';
            stageLabel = 'Baby Plant';
            
            const progress = (heightCm - 3) / 12;
            const ageDays = 6 + (progress * 37);
            estimatedAge = ageDays / 30;
            
            daysToHarvest = Math.max(17, Math.min(69, Math.round(80 - ageDays)));
            harvestWindow = {
                min: Math.max(0, Math.round(60 - ageDays)),
                max: Math.max(0, Math.round(100 - ageDays))
            };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // VEGETATIVE STAGE (31-68 days, 15-60 cm)
        if (heightCm >= 15 && heightCm < 60 && !hasFlowers && !hasGreenFruits && !hasRipeFruits) {
            growthStage = 'vegetative';
            stageLabel = 'Growing Fast';
            
            const progress = (heightCm - 15) / 45;
            const ageDays = 31 + (progress * 37);
            estimatedAge = ageDays / 30;
            
            daysToHarvest = Math.max(0, Math.min(49, Math.round(80 - ageDays)));
            harvestWindow = {
                min: Math.max(0, Math.round(60 - ageDays)),
                max: Math.max(0, Math.round(100 - ageDays))
            };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // FLOWERING STAGE (51-98 days, has flowers)
        if (hasFlowers && !hasGreenFruits && !hasRipeFruits) {
            growthStage = 'flowering';
            stageLabel = 'Has Flowers';
            
            let ageDays = 71;
            if (heightCm && heightCm >= 60) {
                const progress = Math.min(1, (heightCm - 60) / 30);
                ageDays = 51 + (progress * 47);
            }
            
            estimatedAge = ageDays / 30;
            daysToHarvest = Math.max(0, Math.min(29, Math.round(80 - ageDays)));
            harvestWindow = {
                min: Math.max(0, Math.round(60 - ageDays)),
                max: Math.max(0, Math.round(100 - ageDays))
            };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // POLLINATION STAGE (71-128 days, flowers being pollinated)
        if (hasFlowers && hasGreenFruits && !hasRipeFruits) {
            growthStage = 'pollination';
            stageLabel = 'Being Pollinated';
            
            let ageDays = 100;
            if (heightCm && heightCm >= 90) {
                const progress = Math.min(1, (heightCm - 90) / 30);
                ageDays = 71 + (progress * 57);
            }
            
            estimatedAge = ageDays / 30;
            
            // CRITICAL FIX: For pollination stage, days to harvest should be 15-30 days
            // Based on fruit formation (20-30 days) + ripening (15-20 days)
            const daysLeftMin = 60 - ageDays;
            const daysLeftMax = 100 - ageDays;
            
            // More accurate calculation for pollination stage
            if (ageDays < 91) {
                // Early pollination: ~30-40 days to harvest
                daysToHarvest = Math.max(25, Math.min(40, Math.round(100 - ageDays)));
            } else if (ageDays < 110) {
                // Mid pollination: ~20-30 days to harvest
                daysToHarvest = Math.max(15, Math.min(30, Math.round(90 - ageDays)));
            } else {
                // Late pollination: ~10-20 days to harvest
                daysToHarvest = Math.max(5, Math.min(20, Math.round(80 - ageDays)));
            }
            
            harvestWindow = {
                min: Math.max(0, Math.round(60 - ageDays)),
                max: Math.max(0, Math.round(100 - ageDays))
            };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // FRUIT FORMATION STAGE (91-158 days, green fruits present)
        if (hasGreenFruits && !hasRipeFruits) {
            growthStage = 'fruit_formation';
            stageLabel = 'Small Fruits';
            
            let ageDays = 125;
            if (heightCm && heightCm >= 120) {
                const progress = Math.min(1, (heightCm - 120) / 30);
                ageDays = 91 + (progress * 67);
            }
            
            estimatedAge = ageDays / 30;
            
            // For fruit formation, days to harvest = 15-30 days
            const progressInStage = (ageDays - 91) / 67;
            daysToHarvest = Math.max(0, Math.round(30 - (progressInStage * 20)));
            
            harvestWindow = {
                min: Math.max(0, Math.round(15 - (progressInStage * 10))),
                max: Math.max(0, Math.round(30 - (progressInStage * 20)))
            };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // RIPENING STAGE (106-178 days, fruits turning color)
        if (hasRipeFruits) {
            growthStage = 'ripening';
            stageLabel = 'Turning Red';
            
            let ageDays = 142;
            if (heightCm && heightCm >= 150) {
                const progress = Math.min(1, (heightCm - 150) / 30);
                ageDays = 106 + (progress * 72);
            }
            
            estimatedAge = ageDays / 30;
            
            // For ripening, days to harvest = 0-15 days
            const progressInStage = (ageDays - 106) / 72;
            daysToHarvest = Math.max(0, Math.round(15 - (progressInStage * 15)));
            
            harvestWindow = {
                min: 0,
                max: Math.max(0, Math.round(15 - (progressInStage * 15)))
            };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // HARVEST STAGE (ready to pick)
        if (hasRipeFruits && harvestCount > 0) {
            growthStage = 'harvest';
            stageLabel = 'Ready to Pick';
            estimatedAge = 5.0; // ~5 months
            daysToHarvest = 0;
            harvestWindow = { min: 0, max: 0 };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // If we get here, use node-based estimation as fallback
        if (nodeCount && nodeCount > 0) {
            const nodeAge = (nodeCount * 7) / 30;
            estimatedAge += nodeAge * 0.5;
            growthStage = this.determineGrowthStage(estimatedAge * 30);
            stageLabel = this.getStageLabel(growthStage);
            
            const ageDays = estimatedAge * 30;
            daysToHarvest = Math.max(0, Math.round(80 - ageDays));
            harvestWindow = {
                min: Math.max(0, Math.round(60 - ageDays)),
                max: Math.max(0, Math.round(100 - ageDays))
            };
            
            return {
                estimatedAgeMonths: Math.round(estimatedAge * 10) / 10,
                growthStage,
                stageLabel,
                confidenceFactors,
                daysToHarvest,
                harvestWindow,
                characteristics
            };
        }

        // Default fallback
        return {
            estimatedAgeMonths: 0,
            growthStage: 'unknown',
            stageLabel: 'Unknown',
            confidenceFactors: [],
            daysToHarvest: 80,
            harvestWindow: {
                min: 60,
                max: 100
            },
            characteristics
        };
    }

    /**
     * Get farmer-friendly stage label
     */
    getStageLabel(stage) {
        const labels = {
            'germination': 'Just Sprouted',
            'early_growth': 'Baby Plant',
            'vegetative': 'Growing Fast',
            'flowering': 'Has Flowers',
            'pollination': 'Being Pollinated',
            'fruit_formation': 'Small Fruits',
            'ripening': 'Turning Red',
            'harvest': 'Ready to Pick',
            'end_of_life': 'Plant Dying'
        };
        return labels[stage] || stage;
    }

    /**
     * Determine growth stage based on age in days
     */
    determineGrowthStage(ageDays) {
        if (ageDays <= 8) return 'germination';
        if (ageDays <= 43) return 'early_growth';
        if (ageDays <= 68) return 'vegetative';
        if (ageDays <= 98) return 'flowering';
        if (ageDays <= 128) return 'pollination';
        if (ageDays <= 158) return 'fruit_formation';
        if (ageDays <= 178) return 'ripening';
        if (ageDays <= 200) return 'harvest';
        return 'end_of_life';
    }

    /**
     * Predict future growth milestones
     */
    predictMilestones(currentAge, growthStage) {
        const predictions = {};
        const ageDays = currentAge * 30;
        
        predictions.nextMilestones = [];
        
        const stages = [
            { name: 'early_growth', days: 43, label: 'Baby Plant' },
            { name: 'vegetative', days: 68, label: 'Growing Fast' },
            { name: 'flowering', days: 98, label: 'Has Flowers' },
            { name: 'pollination', days: 128, label: 'Being Pollinated' },
            { name: 'fruit_formation', days: 158, label: 'Small Fruits' },
            { name: 'ripening', days: 178, label: 'Turning Red' },
            { name: 'harvest', days: 200, label: 'Ready to Pick' }
        ];
        
        for (const stage of stages) {
            if (stage.days > ageDays) {
                const daysToStage = Math.round(stage.days - ageDays);
                predictions.nextMilestones.push({
                    milestone: stage.label,
                    expectedIn: `${daysToStage} days`,
                    description: this._getStageDescription(stage.name)
                });
                if (predictions.nextMilestones.length >= 2) break;
            }
        }
        
        return predictions;
    }

    _getStageDescription(stage) {
        const descriptions = {
            'germination': 'Seed sprouting, first leaves appear',
            'early_growth': 'Developing true leaves and roots',
            'vegetative': 'Vines lengthen, foliage grows',
            'flowering': 'Yellow flowers appear',
            'pollination': 'Flowers being pollinated',
            'fruit_formation': 'Small green fruits form',
            'ripening': 'Fruits turn color',
            'harvest': 'Ready to pick!',
            'end_of_life': 'Plant finished producing'
        };
        return descriptions[stage] || '';
    }

    calculateAgeFromPlantingDate(plantingDate) {
        const plantDate = new Date(plantingDate);
        const now = new Date();
        const diffTime = Math.abs(now - plantDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const diffMonths = diffDays / 30;
        
        return {
            days: diffDays,
            months: Math.round(diffMonths * 10) / 10
        };
    }

    predictHarvestSchedule(plantData, assessmentData) {
        const inputs = {
            plantId: plantData.id,
            plantName: plantData.plant_name,
            growthStage: plantData.growth_stage,
            estimatedAgeMonths: plantData.estimated_age_months,
            ...assessmentData
        };

        return ruleBasedPredictor.predict(inputs);
    }

    getHarvestPredictionOptions() {
        return ruleBasedPredictor.getInputOptions();
    }

    generateHarvestCalendar(plantId, predictions) {
        const calendar = [];
        const today = new Date();
        const harvestDate = new Date(predictions.prediction.predictedDate);
        
        if (predictions.prediction.readinessLevel === 'finished' || 
            predictions.prediction.readinessLevel === 'final_harvest') {
            return [];
        }
        
        let currentDate = new Date();
        let weekCount = 0;
        
        while (currentDate <= harvestDate && weekCount < 8) {
            const daysDiff = Math.ceil((harvestDate - currentDate) / (1000 * 60 * 60 * 24));
            
            let milestone = '';
            if (daysDiff > 30) {
                milestone = 'Plant is growing - continue regular care';
            } else if (daysDiff > 14) {
                milestone = 'Fruits developing - watch them grow';
            } else if (daysDiff > 7) {
                milestone = 'Fruits sizing up - watch for color change';
            } else if (daysDiff > 3) {
                milestone = 'Almost ready! Check daily';
            } else if (daysDiff > 0) {
                milestone = 'Harvest soon! Check for ripeness';
            }

            calendar.push({
                date: currentDate.toISOString().split('T')[0],
                daysToHarvest: daysDiff,
                weekNumber: weekCount + 1,
                milestone
            });

            currentDate.setDate(currentDate.getDate() + 7);
            weekCount++;
        }

        return calendar;
    }
}

module.exports = new PlantAgeService();