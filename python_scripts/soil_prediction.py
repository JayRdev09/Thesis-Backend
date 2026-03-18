import pandas as pd
import joblib
import numpy  as np
import warnings
import json
import sys
import os
import logging
import time
import re

# Configure logging to output to stderr
logging.basicConfig(level=logging.INFO, format='%(message)s', stream=sys.stderr)
# Set UTF-8 encoding for stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
warnings.filterwarnings("ignore")

class SoilAnalyzer:
    def __init__(self):
        """Initialize soil analyzer with pre-trained models ONLY"""
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            
            # Load soil model
            soil_model_path = os.path.join(script_dir, 'models', 'soil_regressor_rf.pkl')
            if not os.path.exists(soil_model_path):
                soil_model_path = os.path.join(script_dir, 'soil_regressor_rf.pkl')
            
            self.soil_model = joblib.load(soil_model_path)
            logging.info("Soil prediction model loaded")
            
            # Load scaler
            scaler_path = os.path.join(script_dir, 'models', 'scaler_soil.pkl')
            if not os.path.exists(scaler_path):
                scaler_path = os.path.join(script_dir, 'scaler_soil.pkl')
            
            self.scaler = joblib.load(scaler_path)
            logging.info("Feature scaler loaded")
            
        except Exception as e:
            logging.error(f"Error loading soil models: {e}")
            raise

    def map_to_model_fields(self, soil_data):
        """Map Supabase field names to model field names"""
        field_mapping = {
            'ph_level': 'Soil_pH',
            'temperature': 'Temperature',
            'moisture': 'Moisture',
            'nitrogen': 'N',
            'phosphorus': 'P',
            'potassium': 'K'
        }
        
        mapped_data = {}
        for supabase_field, model_field in field_mapping.items():
            if supabase_field in soil_data:
                mapped_data[model_field] = soil_data[supabase_field]
            else:
                raise KeyError(f"Missing required field: {supabase_field}")
        
        return mapped_data
    
    # CALCULATING MODEL CONFIDENCE
    def calculate_model_confidence(self, X_soil_scaled):
        """Calculate real confidence score with proper error handling"""
        try:
            
            tree_predictions = []
            for tree in self.soil_model.estimators_:
                pred = tree.predict(X_soil_scaled)[0]
                tree_predictions.append(pred)
            
            
            std_dev = np.std(tree_predictions)
            mean_pred = np.mean(tree_predictions)
            
           
            if std_dev == 0:
                return 1.0
            if mean_pred == 0:
                cv = std_dev
            else:
                cv = std_dev / abs(mean_pred)
            
            
            confidence = 1.0 / (1.0 + cv)
            
            logging.info(f"Model confidence calculation: mean={mean_pred:.2f}, std={std_dev:.2f}, cv={cv:.3f}, confidence={confidence:.3f}")
            
            return float(confidence)
            
        except Exception as e:
            logging.error(f"FATAL: Confidence calculation failed: {e}")
            raise ValueError(f"Cannot calculate confidence: {str(e)}")
    

    def categorize_soil(self, soil_quality, quality_thresholds):
        """Categorize soil based on thresholds from database"""
        
        thresholds = quality_thresholds['thresholds']
        labels = quality_thresholds['labels']
        
        # Ensure we have correct number of labels (thresholds + 1)
        if len(labels) != len(thresholds) + 1:                
            raise ValueError(f"Expected {len(thresholds) + 1} labels but got {len(labels)}")
        
        # Find the category based on thresholds
        for i, threshold in enumerate(thresholds):
            if soil_quality >= threshold:
                return labels[i]
        
        # If below all thresholds, return the last label
        return labels[-1]

    def analyze_soil(self, soil_data, optimal_ranges):
        """Perform soil analysis using optimal_ranges from database"""
        start_time = time.time()
        try:
            logging.info("Making soil quality prediction...")
            
            # Map fields
            mapped_data = self.map_to_model_fields(soil_data)
            
            # Prepare features for model
            model_feature_names = ["Soil_pH", "Temperature", "Moisture", "N", "P", "K"]
            X_soil = np.array([[mapped_data[feature] for feature in model_feature_names]])
            
            # Scale and predict
            X_soil_scaled = self.scaler.transform(X_soil)
            soil_quality = self.soil_model.predict(X_soil_scaled)[0]
            
            # Calculate confidence
            confidence_score = self.calculate_model_confidence(X_soil_scaled)
            
            # Get quality thresholds from database 
            if 'quality_thresholds' not in optimal_ranges:
                raise ValueError("quality_thresholds not found in the database")
            
            # Get soil status using thresholds from database
            soil_status = self.categorize_soil(soil_quality, optimal_ranges['quality_thresholds'])
            
            # Generate issues
            issues = self.detect_soil_issues(soil_data, optimal_ranges)
            
            # Get recommendations from database ONLY (no fallback)
            recommendations = self.get_database_recommendations(soil_data, optimal_ranges)
            
            inference_time = time.time() - start_time
            
            logging.info(f"Soil analysis complete: {soil_status} (Quality Score: {soil_quality:.1f})")
            
            # SIMPLIFIED RESULT - Only absolutely essential fields
            result = {
                'success': True,
                'soil_status': soil_status,
                'soil_quality_score': float(soil_quality),
                'confidence_score': float(confidence_score),
                'soil_issues': issues,
                'recommendations': recommendations
            }
            
            return result
            
        except Exception as e:
            logging.error(f"Soil analysis error: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': f"Soil analysis failed: {str(e)}"
            }

    def detect_soil_issues(self, soil_data, optimal_ranges):
        """Detect soil issues using optimal_ranges from database"""
        issues = []
        
        # Check for dry soil first - CRITICAL for NPK reliability
        current_moisture = soil_data.get('moisture', 0)
        # Get moisture threshold from optimal_ranges
        moisture_threshold_config = optimal_ranges.get('moisture_threshold', {'optimal': [20, 0]})
        MOISTURE_THRESHOLD = moisture_threshold_config['optimal'][0]  # Minimum moisture % for reliable NPK reading
        
        if current_moisture < MOISTURE_THRESHOLD:
            issues.append(f"Soil is too dry for reliable NPK measurement ({current_moisture}%). Moisturize to at least {MOISTURE_THRESHOLD}% before interpreting nutrient levels.")
            unreliable_npk = True
        else:
            unreliable_npk = False
        
        param_names = {
            'ph_level': 'Soil pH',
            'temperature': 'Temperature',
            'moisture': 'Moisture',
            'nitrogen': 'Nitrogen',
            'phosphorus': 'Phosphorus',
            'potassium': 'Potassium'
        }
        
        for param, config in optimal_ranges.items():
            if param in soil_data and param != 'quality_thresholds' and param != 'soil_recommendations' and param != 'metadata' and param != 'moisture_threshold':
                value = soil_data[param]
                optimal_min, optimal_max = config['optimal']
                unit = config.get('unit', '')
                
                display_name = param_names.get(param, param.capitalize())
                
                # Special handling for NPK when soil is dry
                if unreliable_npk and param in ['nitrogen', 'phosphorus', 'potassium']:
                    issues.append(f"{display_name} reading ({value}{unit}) may be inaccurate due to dry soil. Remeasure after moistening.")
                    continue  # Skip further checks for this parameter
                
                if value < optimal_min:
                    issues.append(f"{display_name} is too low ({value}{unit}) - optimal range: {optimal_min}-{optimal_max}{unit}")
                elif value > optimal_max:
                    issues.append(f"{display_name} is too high ({value}{unit}) - optimal range: {optimal_min}-{optimal_max}{unit}")
        
        if not issues:
            issues = ["All soil parameters are within optimal ranges"]
        
        return issues

    def format_recommendation(self, rec_template, soil_data, optimal_ranges, param, condition):
        """Format a recommendation template with actual values"""
        if not rec_template:
            return None
            
        # Get current value
        current_value = soil_data.get(param, 0)
        
        # Get optimal range for this parameter
        param_config = optimal_ranges.get(param, {})
        optimal_min, optimal_max = param_config.get('optimal', [0, 0])
        unit = param_config.get('unit', '')
        
        # Get moisture threshold for dry soil warning
        moisture_threshold_config = optimal_ranges.get('moisture_threshold', {'optimal': [20, 0]})
        moisture_threshold = moisture_threshold_config['optimal'][0]
        moisture_unit = moisture_threshold_config.get('unit', '%')
        
        # Get NPK values for dry soil warning
        current_n = soil_data.get('nitrogen', 0)
        current_p = soil_data.get('phosphorus', 0)
        current_k = soil_data.get('potassium', 0)
        
        # Calculate deficit for low nutrients
        deficit = optimal_min - current_value if condition == 'low' else 0
        
        # Format the recommendation by replacing placeholders
        formatted_rec = rec_template
        
        # Replace common placeholders
        formatted_rec = formatted_rec.replace('{current}', f"{current_value:.1f}")
        formatted_rec = formatted_rec.replace('{unit}', unit)
        formatted_rec = formatted_rec.replace('{optimal_min}', f"{optimal_min:.0f}")
        formatted_rec = formatted_rec.replace('{optimal_max}', f"{optimal_max:.0f}")
        formatted_rec = formatted_rec.replace('{threshold}', f"{moisture_threshold:.0f}")
        formatted_rec = formatted_rec.replace('{moisture_unit}', moisture_unit)
        formatted_rec = formatted_rec.replace('{N}', f"{current_n:.0f}")
        formatted_rec = formatted_rec.replace('{P}', f"{current_p:.0f}")
        formatted_rec = formatted_rec.replace('{K}', f"{current_k:.0f}")
        formatted_rec = formatted_rec.replace('{deficit}', f"{deficit:.0f}")
        formatted_rec = formatted_rec.replace('{parameter}', param.replace('_', ' ').title())
        
        # Handle specific parameter names
        if param == 'ph_level':
            formatted_rec = formatted_rec.replace('{ph}', f"{current_value:.1f}")
        elif param == 'temperature':
            formatted_rec = formatted_rec.replace('{temp}', f"{current_value:.1f}")
        elif param == 'moisture':
            formatted_rec = formatted_rec.replace('{moisture}', f"{current_value:.1f}")
        
        return formatted_rec

    def get_database_recommendations(self, soil_data, optimal_ranges):
        """Get recommendations from database recommendations table ONLY"""
        recommendations = []
        
        # Check if database recommendations are available
        if 'soil_recommendations' not in optimal_ranges:
            error_msg = "soil_recommendations not found in database. Cannot generate recommendations without database templates."
            logging.error(error_msg)
            raise ValueError(error_msg)
        
        db_recs = optimal_ranges['soil_recommendations']
        logging.info(f"Using database recommendations for parameters: {list(db_recs.keys())}")
        
        # Check for dry soil first (critical)
        current_moisture = soil_data.get('moisture', 0)
        moisture_threshold_config = optimal_ranges.get('moisture_threshold', {'optimal': [20, 0]})
        moisture_threshold = moisture_threshold_config['optimal'][0]
        
        # Add dry soil warning if needed
        if current_moisture < moisture_threshold:
            if 'moisture' in db_recs and 'dry_soil' in db_recs['moisture']:
                rec_data = db_recs['moisture']['dry_soil']
                formatted_rec = self.format_recommendation(
                    rec_data['recommendation'], 
                    soil_data, optimal_ranges, 
                    'moisture', 'dry_soil'
                )
                if formatted_rec:
                    recommendations.append(formatted_rec)
            else:
                logging.warning(f"No dry_soil recommendation found for moisture parameter")
        
        # Check each parameter
        recommendations_added = False
        for param, value in soil_data.items():
            if param not in optimal_ranges or param not in db_recs:
                continue
                
            # Get optimal range for this parameter
            param_config = optimal_ranges.get(param, {})
            optimal_min, optimal_max = param_config.get('optimal', [0, 0])
            
            # Determine condition (low, high, or nutrient_lockout for pH)
            condition = None
            if value < optimal_min:
                condition = 'low'
            elif value > optimal_max:
                condition = 'high'
            
            # Special case for pH - might have nutrient_lockout condition
            if param == 'ph_level' and (value < optimal_min or value > optimal_max):
                # Check if there's a nutrient_lockout recommendation
                if 'nutrient_lockout' in db_recs.get(param, {}):
                    rec_data = db_recs[param]['nutrient_lockout']
                    formatted_rec = self.format_recommendation(
                        rec_data['recommendation'], 
                        soil_data, optimal_ranges, 
                        param, 'nutrient_lockout'
                    )
                    if formatted_rec and formatted_rec not in recommendations:
                        recommendations.append(formatted_rec)
                        recommendations_added = True
            
            # Add parameter-specific recommendation
            if condition and condition in db_recs.get(param, {}):
                rec_data = db_recs[param][condition]
                formatted_rec = self.format_recommendation(
                    rec_data['recommendation'], 
                    soil_data, optimal_ranges, 
                    param, condition
                )
                if formatted_rec and formatted_rec not in recommendations:
                    recommendations.append(formatted_rec)
                    recommendations_added = True
        
        # If no recommendations were added but we have database recommendations available,
        # this means all parameters are within optimal ranges
        if not recommendations_added and recommendations:
            # We already have dry soil warning, that's enough
            pass
        elif not recommendations:
            # Check if there's a default recommendation in the database
            # You could add a default recommendation in your soil_recommendations table
            # with a special key like 'default' or 'all_good'
            default_found = False
            for param_recs in db_recs.values():
                if 'all_good' in param_recs:
                    rec_data = param_recs['all_good']
                    recommendations.append(rec_data['recommendation'])
                    default_found = True
                    break
            
            if not default_found:
                # If no default in database, return empty list (backend can handle empty recommendations)
                logging.info("All parameters are within optimal ranges, no recommendations needed")
        
        return recommendations

def main():
    """Main function for soil prediction"""
    try:
        # FIX: Read from stdin instead of command line argument
        if len(sys.argv) > 1:
            # For backward compatibility, still support command line args
            input_data = json.loads(sys.argv[1])
            logging.warning("Using command line argument (deprecated - may cause ENAMETOOLONG)")
        else:
            # Read from stdin
            input_data = json.loads(sys.stdin.read())
        
        soil_data = input_data.get('soil_data', {})
        optimal_ranges = input_data.get('optimal_ranges', {})
        user_id = input_data.get('user_id', 'unknown')
        soil_id = input_data.get('soil_id', 'unknown')
        
        logging.info(f"Analyzing soil for user: {user_id}")
        
        if not soil_data:
            result = {
                'success': False,
                'error': 'No soil data provided'
            }
            print(json.dumps(result))
            return
        
        if not optimal_ranges:
            result = {
                'success': False,
                'error': 'No optimal ranges provided from database'
            }
            print(json.dumps(result))
            return
        
        analyzer = SoilAnalyzer()
        result = analyzer.analyze_soil(soil_data, optimal_ranges)
        result['user_id'] = user_id
        result['soil_id'] = soil_id
        
        logging.info(f"Soil prediction completed for user: {user_id}")
        print(json.dumps(result, default=str))
        
    except Exception as e:
        result = {
            'success': False,
            'error': f"Soil prediction failed: {str(e)}"
        }
        print(json.dumps(result))

if __name__ == "__main__":
    main()