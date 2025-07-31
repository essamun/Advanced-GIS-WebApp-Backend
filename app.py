import os
from flask import Flask, render_template, jsonify
import psycopg2
import json

from dotenv import load_dotenv
load_dotenv()  # This loads the environment variables from .env file


# Add these new imports at the top
from flask import request
import geojson


app = Flask(__name__)



#def get_conn():

def get_conn():
    try:
        return psycopg2.connect(
            host=os.getenv('DB_HOST'),
            dbname=os.getenv('DB_NAME'),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD'),
            port=os.getenv('DB_PORT', '5432')  # Default PostgreSQL port
        )
    except psycopg2.Error as e:
        print(f"Error connecting to PostgreSQL database: {e}")
        raise


def fetch_geojson(table_name):
    conn = get_conn()
    cur = conn.cursor()
    sql = f"""
        SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
                jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(wkb_geometry)::jsonb,
                    'properties', to_jsonb(row) - 'wkb_geometry'
                )
            )
        )
        FROM (SELECT * FROM {table_name}) row;
    """
    cur.execute(sql)
    result = cur.fetchone()[0]
    cur.close()
    conn.close()
    return result

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/<layer_name>')
def api_layer(layer_name):
    return jsonify(fetch_geojson(layer_name))


# Add these new routes after your existing routes
@app.route('/api/business/add', methods=['POST'])
def add_business():
    data = request.get_json()
    name = data.get('name')
    biz_type = data.get('type')
    lat = data.get('lat')
    lng = data.get('lng')
    
    if not all([name, biz_type, lat, lng]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_conn()
    cur = conn.cursor()
    
    try:
        # Insert new business with geometry
        sql = """
        INSERT INTO business (name, type, wkb_geometry)
        VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
        RETURNING ogc_fid, name, type, ST_AsGeoJSON(wkb_geometry)::json as geometry
        """
        cur.execute(sql, (name, biz_type, lng, lat))
        result = cur.fetchone()
        
        conn.commit()
        
        # Format the response as GeoJSON feature
        feature = {
            "type": "Feature",
            "geometry": result[3],
            "properties": {
                "ogc_fid": result[0],
                "name": result[1],
                "type": result[2]
            }
        }
        
        return jsonify(feature), 201
        
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/business/update/<int:business_id>', methods=['PUT'])
def update_business(business_id):
    data = request.get_json()
    name = data.get('name')
    biz_type = data.get('type')
    
    if not all([name, biz_type]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_conn()
    cur = conn.cursor()
    
    try:
        sql = """
        UPDATE business 
        SET name = %s, type = %s
        WHERE ogc_fid = %s
        RETURNING ogc_fid, name, type, ST_AsGeoJSON(wkb_geometry)::json as geometry
        """
        cur.execute(sql, (name, biz_type, business_id))
        
        if cur.rowcount == 0:
            return jsonify({'error': 'Business not found'}), 404
            
        result = cur.fetchone()
        conn.commit()
        
        feature = {
            "type": "Feature",
            "geometry": result[3],
            "properties": {
                "ogc_fid": result[0],
                "name": result[1],
                "type": result[2]
            }
        }
        
        return jsonify(feature)
        
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/business/delete/<int:business_id>', methods=['DELETE'])
def delete_business(business_id):
    conn = get_conn()
    cur = conn.cursor()
    
    try:
        # First check if business exists
        cur.execute("SELECT ogc_fid FROM business WHERE ogc_fid = %s", (business_id,))
        if not cur.fetchone():
            return jsonify({'error': 'Business not found'}), 404
            
        # Delete the business
        cur.execute("DELETE FROM business WHERE ogc_fid = %s", (business_id,))
        conn.commit()
        
        return jsonify({'success': True})
        
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()



if __name__ == '__main__':
    app.run(debug=True)