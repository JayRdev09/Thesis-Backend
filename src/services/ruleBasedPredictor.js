class RuleBasedPredictor {
    constructor() {
        // ENHANCED: Growth stage mapping with more accurate days to harvest
        this.growthStageMap = {
            'germination': { 
                days: 80, // Average days to harvest from germination
                daysMin: 60,
                daysMax: 100,
                description: 'Just sprouted - long way to go',
                harvestWindow: '60-100 days'
            },
            'early_growth': { 
                days: 55, // Average days left from early growth
                daysMin: 43,
                daysMax: 69,
                description: 'Baby plant - developing leaves and roots',
                harvestWindow: '43-69 days' 
            },
            'vegetative': { 
                days: 40, // Average days left from vegetative
                daysMin: 30,
                daysMax: 49,
                description: 'Growing fast - vines lengthening',
                harvestWindow: '30-49 days' 
            },
            'flowering': { 
                days: 30, // Average days left from flowering
                daysMin: 20,
                daysMax: 35,
                description: 'Has flowers - pollination happening',
                harvestWindow: '20-35 days' 
            },
            'pollination': { 
                days: 25, // FIXED: 25 days average for pollination (was 10)
                daysMin: 15,
                daysMax: 35,
                description: 'Flowers being pollinated - fruits will start forming',
                harvestWindow: '15-35 days' 
            },
            'fruit_formation': { 
                days: 18, // Average days left from fruit formation
                daysMin: 10,
                daysMax: 25,
                description: 'Small green fruits forming',
                harvestWindow: '10-25 days' 
            },
            'ripening': { 
                days: 8, // Average days left from ripening
                daysMin: 3,
                daysMax: 15,
                description: 'Fruits turning color',
                harvestWindow: '3-15 days' 
            },
            'harvest': { 
                days: 0,
                daysMin: 0,
                daysMax: 0,
                description: 'Ready to pick!',
                harvestWindow: 'Now'
            },
            'end_of_life': { 
                days: 0,
                daysMin: 0,
                daysMax: 0,
                description: 'Plant finished - no more harvests',
                harvestWindow: 'Remove plant'
            }
        };

        // Fruit size mapping - calibrated to match stage progression
        this.fruitSizeMap = {
            'tiny': { 
                days: 28, 
                daysMin: 20,
                daysMax: 35,
                description: 'Just set, like a marble - fruit formation stage' 
            },
            'small': { 
                days: 22, 
                daysMin: 15,
                daysMax: 28,
                description: 'Still growing - early fruit development' 
            },
            'medium': { 
                days: 15, 
                daysMin: 10,
                daysMax: 20,
                description: 'Half to three-quarters size - mid development' 
            },
            'large': { 
                days: 10, 
                daysMin: 5,
                daysMax: 15,
                description: 'Near full size - late development' 
            },
            'almost ready': { 
                days: 5, 
                daysMin: 2,
                daysMax: 8,
                description: 'Full size, starting to color - ripening stage' 
            }
        };

        // Fruit color mapping - most accurate predictor
        this.fruitColorMap = {
            'green': { 
                days: 28, 
                daysMin: 20,
                daysMax: 35,
                description: 'Completely green - fruit formation' 
            },
            'yellowish': { 
                days: 18, 
                daysMin: 12,
                daysMax: 25,
                description: 'Starting to turn - early ripening' 
            },
            'orange': { 
                days: 8, 
                daysMin: 3,
                daysMax: 12,
                description: 'Mostly orange - mid ripening' 
            },
            'red': { 
                days: 0, 
                daysMin: 0,
                daysMax: 0,
                description: 'Ready to harvest!' 
            }
        };

        this.stageLabels = {
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
    }

    /**
     * Predict harvest date based on user inputs and plant age
     * ENHANCED: Better calibration for pollination stage
     */
    predict(userInputs) {
        const today = new Date();
        let daysToHarvest = 80;
        let daysMin = 60;
        let daysMax = 100;
        let appliedRules = [];
        let reasoning = [];
        
        const estimatedAgeMonths = userInputs.estimatedAgeMonths || 0;
        const growthStage = userInputs.growthStage || 'unknown';
        const ageDays = estimatedAgeMonths * 30;
        
        console.log(`🔮 Predicting harvest - Age: ${estimatedAgeMonths} months (${ageDays} days), Stage: ${growthStage}`);

        // SPECIAL CASE 1: END OF LIFE
        if (growthStage === 'end_of_life' || estimatedAgeMonths >= 6.5) {
            return this.buildEndOfLifeResponse(today, userInputs);
        }

        // SPECIAL CASE 2: HARVEST READY
        if (growthStage === 'harvest' || userInputs.hasRipeFruits) {
            daysToHarvest = 0;
            daysMin = 0;
            daysMax = 0;
            appliedRules.push('harvest_ready');
            reasoning.push('Plant is ready to harvest now!');
            return this.buildResponse(daysToHarvest, daysMin, daysMax, today, userInputs, appliedRules, reasoning);
        }

        // SPECIAL CASE 3: RIPENING STAGE
        if (growthStage === 'ripening') {
            daysToHarvest = 8;
            daysMin = 3;
            daysMax = 15;
            appliedRules.push('ripening');
            reasoning.push('Fruits are turning color - about 1-2 weeks to harvest');
            return this.buildResponse(daysToHarvest, daysMin, daysMax, today, userInputs, appliedRules, reasoning);
        }

        // SPECIAL CASE 4: FRUIT FORMATION
        if (growthStage === 'fruit_formation') {
            daysToHarvest = 18;
            daysMin = 10;
            daysMax = 25;
            appliedRules.push('fruit_formation');
            reasoning.push('Small fruits forming - about 2-3 weeks to harvest');
            return this.buildResponse(daysToHarvest, daysMin, daysMax, today, userInputs, appliedRules, reasoning);
        }

        // SPECIAL CASE 5: POLLINATION - FIXED with accurate range
        if (growthStage === 'pollination') {
            // More accurate calculation based on age within pollination stage
            if (ageDays < 91) {
                // Early pollination: 25-35 days
                daysToHarvest = 30;
                daysMin = 25;
                daysMax = 35;
            } else if (ageDays < 110) {
                // Mid pollination: 20-30 days
                daysToHarvest = 25;
                daysMin = 20;
                daysMax = 30;
            } else {
                // Late pollination: 15-25 days
                daysToHarvest = 20;
                daysMin = 15;
                daysMax = 25;
            }
            
            appliedRules.push('pollination');
            reasoning.push(`Flowers being pollinated - about ${daysToHarvest} days to harvest`);
            return this.buildResponse(daysToHarvest, daysMin, daysMax, today, userInputs, appliedRules, reasoning);
        }

        // Rule 1: Use growth stage as primary indicator
        if (growthStage && this.growthStageMap[growthStage]) {
            daysToHarvest = this.growthStageMap[growthStage].days;
            daysMin = this.growthStageMap[growthStage].daysMin;
            daysMax = this.growthStageMap[growthStage].daysMax;
            
            // Adjust based on age within stage
            if (estimatedAgeMonths > 0) {
                const stageData = this._getStageCumulativeDays(growthStage);
                if (stageData) {
                    const progressInStage = Math.max(0, Math.min(1, 
                        (ageDays - stageData.min) / (stageData.max - stageData.min)));
                    
                    // Adjust days based on progress
                    const range = daysMax - daysMin;
                    daysToHarvest = Math.max(daysMin, 
                        Math.round(daysMax - (progressInStage * range * 0.7)));
                }
            }
            
            appliedRules.push('growth_stage');
            reasoning.push(`Growth stage: ${this._getStageLabel(growthStage)}`);
        }

        // Rule 2: Age-based estimation
        if (ageDays > 0 && (!growthStage || growthStage === 'unknown')) {
            const daysRemaining = Math.max(0, 100 - ageDays);
            const daysRemainingMin = Math.max(0, 60 - ageDays);
            
            daysToHarvest = Math.round((daysRemaining + daysRemainingMin) / 2);
            daysMin = Math.max(0, daysRemainingMin);
            daysMax = Math.max(daysToHarvest, Math.round(daysRemaining));
            
            reasoning.push(`Based on estimated age: ${Math.round(ageDays)} days old`);
            appliedRules.push('age_estimate');
        }

        // Rule 3: Fruit size adjustment (most accurate after color)
        if (userInputs.fruitSize && this.fruitSizeMap[userInputs.fruitSize]) {
            const sizeData = this.fruitSizeMap[userInputs.fruitSize];
            
            if (sizeData.days < daysToHarvest) {
                daysToHarvest = sizeData.days;
                daysMin = sizeData.daysMin;
                daysMax = sizeData.daysMax;
                appliedRules.push('fruit_size');
                reasoning.push(`Fruit size: ${this._formatLabel(userInputs.fruitSize)}`);
            }
        }

        // Rule 4: Fruit color adjustment (most accurate)
        if (userInputs.fruitColor && this.fruitColorMap[userInputs.fruitColor]) {
            const colorData = this.fruitColorMap[userInputs.fruitColor];
            
            if (colorData.days < daysToHarvest) {
                daysToHarvest = colorData.days;
                daysMin = colorData.daysMin;
                daysMax = colorData.daysMax;
                appliedRules.push('fruit_color');
                reasoning.push(`Fruit color: ${this._formatLabel(userInputs.fruitColor)}`);
            }
        }

        const confidence = this.calculateConfidence(userInputs, appliedRules, estimatedAgeMonths, growthStage);
        return this.buildResponse(daysToHarvest, daysMin, daysMax, today, userInputs, appliedRules, reasoning, confidence);
    }

    /**
     * Get cumulative days for a growth stage
     */
    _getStageCumulativeDays(stage) {
        const stageCumulativeDays = {
            'germination': { min: 0, max: 8 },
            'early_growth': { min: 6, max: 43 },
            'vegetative': { min: 31, max: 68 },
            'flowering': { min: 51, max: 98 },
            'pollination': { min: 71, max: 128 },
            'fruit_formation': { min: 91, max: 158 },
            'ripening': { min: 106, max: 178 },
            'harvest': { min: 126, max: 178 }
        };
        return stageCumulativeDays[stage];
    }

    /**
     * Build response with accurate harvest window
     */
    buildResponse(daysToHarvest, daysMin, daysMax, today, inputs, appliedRules, reasoning, confidence = 0.8) {
        const predictedDate = new Date();
        predictedDate.setDate(today.getDate() + daysToHarvest);

        const earliestDate = new Date(today);
        earliestDate.setDate(today.getDate() + Math.max(0, daysMin));
        
        const latestDate = new Date(today);
        latestDate.setDate(today.getDate() + daysMax);

        let readinessLevel = 'unknown';
        let readinessMessage = '';

        if (daysToHarvest === 0) {
            readinessLevel = 'ready';
            readinessMessage = 'Ready to harvest now!';
        } else if (daysToHarvest <= 7) {
            readinessLevel = 'very_close';
            readinessMessage = 'Almost ready! Check daily for color changes.';
        } else if (daysToHarvest <= 15) {
            readinessLevel = 'close';
            readinessMessage = 'Getting close. Watch fruit development.';
        } else if (daysToHarvest <= 30) {
            readinessLevel = 'moderate';
            readinessMessage = 'Still developing. Continue regular care.';
        } else {
            readinessLevel = 'far';
            readinessMessage = `${daysToHarvest} days to harvest - be patient.`;
        }

        const careTips = this.generateCareTips(daysToHarvest, inputs, readinessLevel);

        return {
            success: true,
            prediction: {
                predictedDate: predictedDate.toISOString().split('T')[0],
                daysToHarvest,
                harvestWindow: {
                    earliest: earliestDate.toISOString().split('T')[0],
                    latest: latestDate.toISOString().split('T')[0]
                },
                confidence: Math.round(confidence * 100) / 100,
                readinessLevel,
                readinessMessage,
                appliedRules,
                reasoning,
                careTips
            },
            inputs: inputs
        };
    }

    buildEndOfLifeResponse(today, inputs) {
        const careTips = [
            '✅ Plant has finished producing - time to remove it',
            '✅ Pull out the plant and compost if disease-free',
            '✅ Prepare soil for next planting',
            '✅ Rotate crops to prevent disease next season'
        ];

        return {
            success: true,
            prediction: {
                predictedDate: today.toISOString().split('T')[0],
                daysToHarvest: 0,
                harvestWindow: {
                    earliest: today.toISOString().split('T')[0],
                    latest: today.toISOString().split('T')[0]
                },
                confidence: 0.95,
                readinessLevel: 'finished',
                readinessMessage: 'Plant has finished producing - no more harvests',
                appliedRules: ['end_of_life'],
                reasoning: ['Plant has reached end of life - remove and prepare for next season'],
                careTips
            },
            inputs: inputs
        };
    }

    calculateConfidence(inputs, appliedRules, estimatedAgeMonths = 0, growthStage = '') {
        let baseConfidence = 0.3;
        let ruleMultiplier = 0;

        const ruleWeights = {
            'harvest_ready': 0.4,
            'fruit_color': 0.35,
            'fruit_size': 0.3,
            'growth_stage': 0.3,
            'pollination': 0.3,
            'ripening': 0.35,
            'fruit_formation': 0.3,
            'age_estimate': 0.25,
            'end_of_life': 0.4
        };

        appliedRules.forEach(rule => {
            if (ruleWeights[rule]) {
                ruleMultiplier += ruleWeights[rule];
            }
        });

        if (inputs.fruitColor && inputs.fruitSize) {
            ruleMultiplier += 0.1;
        }

        if (growthStage && growthStage !== 'unknown' && inputs.estimatedAgeMonths > 0) {
            ruleMultiplier += 0.1;
        }

        return Math.min(baseConfidence + ruleMultiplier, 0.95);
    }

    generateCareTips(daysToHarvest, inputs, readinessLevel) {
        const tips = [];

        if (readinessLevel === 'finished') {
            tips.push('✅ Plant has finished producing - time to remove it');
            tips.push('✅ Pull out the plant and compost if disease-free');
            tips.push('✅ Prepare soil for next planting');
        } else if (daysToHarvest === 0) {
            tips.push('✅ Harvest ripe fruits promptly to encourage more production');
            tips.push('✅ Use clean scissors or pruners to avoid damaging the plant');
            tips.push('✅ Store at room temperature, not in refrigerator');
        } else if (daysToHarvest <= 7) {
            tips.push('💧 Reduce watering slightly to concentrate flavor');
            tips.push('☀️ Protect from intense sun to prevent sunscald');
            tips.push('🔍 Check daily for color change');
        } else if (daysToHarvest <= 15) {
            tips.push('💧 Maintain consistent watering');
            tips.push('🌱 Apply potassium-rich fertilizer for fruit development');
            tips.push('✂️ Remove yellowing leaves for air circulation');
        } else if (daysToHarvest <= 30) {
            tips.push('💧 Deep watering 2-3 times per week');
            tips.push('🌿 Support heavy fruit clusters');
            tips.push('🌱 Mulch to retain moisture');
        } else {
            tips.push('💧 Keep soil moist but not wet');
            tips.push('🌿 Provide plenty of sunlight (6-8 hours)');
            tips.push('🌱 Protect from cold temperatures');
        }

        if (inputs.growthStage === 'flowering') {
            tips.push('🌸 Encourage pollinators - plant flowers nearby');
        }
        if (inputs.growthStage === 'pollination') {
            tips.push('🐝 Gently shake plants to help pollination');
        }
        if (inputs.leafCondition === 'yellowing') {
            tips.push('🍂 Yellowing leaves may indicate nitrogen deficiency - fertilize');
        }
        if (inputs.leafCondition === 'wilting') {
            tips.push('💧 Wilting leaves need water - check soil moisture');
        }

        return tips;
    }

    _formatLabel(value) {
        if (!value) return '';
        return value.charAt(0).toUpperCase() + value.slice(1).replace('_', ' ');
    }

    _getStageLabel(stage) {
        return this.stageLabels[stage] || stage;
    }

    getInputOptions() {
        return {
            fruitSizes: Object.keys(this.fruitSizeMap).map(key => ({
                value: key,
                label: this._formatLabel(key),
                description: this.fruitSizeMap[key].description,
                days: this.fruitSizeMap[key].days,
                daysMin: this.fruitSizeMap[key].daysMin,
                daysMax: this.fruitSizeMap[key].daysMax
            })),
            fruitColors: Object.keys(this.fruitColorMap).map(key => ({
                value: key,
                label: this._formatLabel(key),
                description: this.fruitColorMap[key].description,
                days: this.fruitColorMap[key].days,
                daysMin: this.fruitColorMap[key].daysMin,
                daysMax: this.fruitColorMap[key].daysMax
            })),
            growthStages: Object.keys(this.growthStageMap).map(key => ({
                value: key,
                label: this._getStageLabel(key),
                description: this.growthStageMap[key].description,
                days: this.growthStageMap[key].days,
                daysMin: this.growthStageMap[key].daysMin,
                daysMax: this.growthStageMap[key].daysMax,
                harvestWindow: this.growthStageMap[key].harvestWindow
            }))
        };
    }

    predictBatch(plants) {
        const results = [];
        const today = new Date();

        plants.forEach(plant => {
            const prediction = this.predict(plant.inputs);
            results.push({
                plantId: plant.plantId,
                plantName: plant.plantName,
                ...prediction
            });
        });

        results.sort((a, b) => a.prediction.daysToHarvest - b.prediction.daysToHarvest);

        return {
            success: true,
            results,
            summary: {
                totalPlants: results.length,
                readyNow: results.filter(r => r.prediction.daysToHarvest === 0).length,
                readyThisWeek: results.filter(r => r.prediction.daysToHarvest > 0 && r.prediction.daysToHarvest <= 7).length,
                readyThisMonth: results.filter(r => r.prediction.daysToHarvest > 7 && r.prediction.daysToHarvest <= 30).length
            },
            generatedAt: today.toISOString()
        };
    }
}

module.exports = new RuleBasedPredictor();